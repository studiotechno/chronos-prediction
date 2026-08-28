/** Accès aux données pour les pages (server components). Tout est asynchrone : PostgreSQL. */
import { and, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { casseEnseigne } from "./couverture/libelles";
import type { MissionCouverture } from "./couverture/agregat";
import { normalizeDenomination } from "./matching/normalize";
import { distanceKm } from "./scoring/geo";
import { romeLabel } from "./reference/rome";
import { resumeSignal } from "./scoring/raison";
import { detailSignal } from "./signal-detail";
import type { TopSignal } from "./db/schema";

export type LeadListe = {
  siret: string;
  denomination: string;
  commune: string | null;
  codePostal: string | null;
  naf: string;
  effectifEstime: number | null;
  lat: number | null;
  lon: number | null;
  /** Distance retenue : au lieu du besoin quand un signal en porte un, sinon à l'établissement. */
  distanceKm: number | null;
  /** Distance de l'établissement lui-même — pour dire quand le besoin est ailleurs. */
  distanceEtabKm: number | null;
  scoreFinal: number;
  strate: number;
  sismo: number;
  tempo: number;
  statut: string;
  segment: string;
  raisonFr: string;
  propositionFr: string | null;
  fenetreDebut: string | null;
  fenetreFin: string | null;
  lieuBesoinFr: string | null;
  romesInduits: string[];
  topSignals: TopSignal[];
};

export type FiltresLeads = {
  naf?: string; // division (2 chiffres)
  type?: string; // type de signal présent
  dmax?: number; // distance max en km
  smin?: number; // score final minimum
  smax?: number;
};

export async function getAgence() {
  const db = getDb();
  return (await db.select().from(schema.agence).limit(1))[0] ?? null;
}

export type Agence = NonNullable<Awaited<ReturnType<typeof getAgence>>>;

/**
 * Ce que la coquille affiche en permanence : l'agence (donc la zone), les
 * compteurs de la barre latérale, et la provenance des données. Une seule
 * lecture, faite par le layout — les pages n'ont pas à la refaire.
 */
export async function getShellData() {
  const db = getDb();
  const [chaudsRows, resolutionsRows, fixturesRows, agence] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.lead)
      .where(eq(schema.lead.segment, "chaud")),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.resolutionQueue)
      .where(eq(schema.resolutionQueue.statut, "en_attente")),
    db
      .select({ id: schema.signal.id })
      .from(schema.signal)
      .where(like(schema.signal.source, "fixture:%"))
      .limit(1),
    getAgence(),
  ]);

  return {
    agence,
    counts: { chauds: chaudsRows[0]?.n ?? 0, resolutions: resolutionsRows[0]?.n ?? 0 },
    demo: fixturesRows.length > 0,
  };
}

function distanceEtab(
  agence: { lat: number; lon: number } | null,
  etab: { lat: number | null; lon: number | null },
): number | null {
  if (!agence || !Number.isFinite(etab.lat) || !Number.isFinite(etab.lon)) return null;
  return Math.round(distanceKm(etab.lat as number, etab.lon as number, agence.lat, agence.lon) * 10) / 10;
}

export async function getLeads(
  filtres: FiltresLeads = {},
): Promise<{ chauds: LeadListe[]; nurturing: LeadListe[] }> {
  const db = getDb();
  const [agence, rows] = await Promise.all([
    getAgence(),
    db
      .select({
        lead: schema.lead,
        etab: schema.etablissement,
      })
      .from(schema.lead)
      .innerJoin(schema.etablissement, eq(schema.etablissement.siret, schema.lead.siret))
      .orderBy(desc(schema.lead.scoreFinal)),
  ]);

  const liste: LeadListe[] = rows.map(({ lead, etab }) => {
    const dEtab = distanceEtab(agence, etab);
    const dBesoin = Number.isFinite(lead.distanceBesoinKm) ? (lead.distanceBesoinKm as number) : null;
    return {
      siret: lead.siret,
      denomination: etab.denomination,
      commune: etab.commune,
      codePostal: etab.codePostal,
      naf: etab.naf,
      effectifEstime: etab.effectifEstime,
      lat: etab.lat,
      lon: etab.lon,
      distanceKm: dBesoin ?? dEtab,
      distanceEtabKm: dEtab,
      scoreFinal: lead.scoreFinal,
      strate: lead.strate,
      sismo: lead.sismo,
      tempo: Number.isFinite(lead.tempo) ? lead.tempo : 1,
      statut: lead.statut,
      segment: lead.segment,
      raisonFr: lead.raisonFr,
      propositionFr: lead.propositionFr ?? null,
      fenetreDebut: lead.fenetreDebut ?? null,
      fenetreFin: lead.fenetreFin ?? null,
      lieuBesoinFr: lead.lieuBesoinFr ?? null,
      romesInduits: lead.romesInduits ?? [],
      topSignals: lead.topSignals ?? [],
    };
  });

  const filtree = liste.filter((l) => {
    if (filtres.naf && !l.naf.replace(/[^0-9]/g, "").startsWith(filtres.naf)) return false;
    if (filtres.type && !l.topSignals.some((s) => s.type === filtres.type)) return false;
    if (filtres.dmax != null && (l.distanceKm == null || l.distanceKm > filtres.dmax)) return false;
    if (filtres.smin != null && l.scoreFinal < filtres.smin) return false;
    if (filtres.smax != null && l.scoreFinal > filtres.smax) return false;
    return true;
  });

  return {
    chauds: filtree.filter((l) => l.segment === "chaud"),
    nurturing: filtree.filter((l) => l.segment === "nurturing"),
  };
}

export type PointHistorique = {
  jour: string;
  scoreFinal: number;
  strate: number;
  sismo: number;
  tempo: number;
  segment: string;
};

/**
 * Historique quotidien du score d'un établissement (score_snapshot), du plus
 * ancien au plus récent — la mémoire du moteur, pour dire « monté de 30
 * points cette semaine ».
 */
export async function getHistoriqueScores(siret: string, jours = 90): Promise<PointHistorique[]> {
  const db = getDb();
  const depuis = new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);
  const rows = await db
    .select({
      jour: schema.scoreSnapshot.jour,
      scoreFinal: schema.scoreSnapshot.scoreFinal,
      strate: schema.scoreSnapshot.strate,
      sismo: schema.scoreSnapshot.sismo,
      tempo: schema.scoreSnapshot.tempo,
      segment: schema.scoreSnapshot.segment,
    })
    .from(schema.scoreSnapshot)
    .where(and(eq(schema.scoreSnapshot.siret, siret), gte(schema.scoreSnapshot.jour, depuis)))
    .orderBy(schema.scoreSnapshot.jour);
  return rows;
}

export async function getLeadDetail(siret: string) {
  const db = getDb();
  const etab = (await db.select().from(schema.etablissement).where(eq(schema.etablissement.siret, siret)))[0];
  if (!etab) return null;

  const [
    entrepriseRows,
    leadRows,
    strateRows,
    sismoRows,
    tempoRows,
    agence,
    signauxRows,
    offresRows,
    historique,
  ] = await Promise.all([
      db.select().from(schema.entreprise).where(eq(schema.entreprise.siren, etab.siren)),
      db.select().from(schema.lead).where(eq(schema.lead.siret, siret)),
      db.select().from(schema.scoreStrate).where(eq(schema.scoreStrate.siret, siret)),
      db.select().from(schema.scoreSismo).where(eq(schema.scoreSismo.siret, siret)),
      db.select().from(schema.scoreTempo).where(eq(schema.scoreTempo.siret, siret)),
      getAgence(),
      db
        .select()
        .from(schema.signal)
        .where(eq(schema.signal.siret, siret))
        .orderBy(desc(schema.signal.occurredAt)),
      // Staging des offres de cet établissement : le contenu de l'annonce
      // (description, salaire, compétences) que la chronologie déplie.
      db.select().from(schema.offreBrute).where(eq(schema.offreBrute.siret, siret)),
      getHistoriqueScores(siret, 90),
    ]);

  const entreprise = entrepriseRows[0];
  const lead = leadRows[0] ?? null;
  const strate = strateRows[0] ?? null;
  const sismo = sismoRows[0] ?? null;
  const tempo = tempoRows[0] ?? null;

  const offresParId = new Map(offresRows.map((o) => [o.id, o]));

  const signaux = signauxRows.map((s) => ({
    ...s,
    detail: detailSignal(s, offresParId),
    resumeFr: resumeSignal({
      id: s.id,
      type: s.type,
      occurredAt: s.occurredAt,
      confidence: s.confidence,
      payload: s.payload ?? null,
      lieu: s.lieu ?? null,
      romes: s.romes ?? null,
    }),
  }));

  return {
    etab,
    entreprise: entreprise ?? null,
    lead,
    strate,
    sismo,
    tempo,
    signaux,
    historique,
    distanceKm: distanceEtab(agence, etab),
  };
}

/**
 * Couverture concurrentielle : toutes les missions d'intérim postées par des
 * agences sur le bassin, servies telles quelles à la page. Le découpage
 * (fenêtre, enseignes, métiers, tri) se fait ensuite en mémoire côté client —
 * une carte de couverture se lit en comparant, et comparer suppose que
 * changer d'angle soit instantané.
 */

/** Plafond de sécurité : au-delà, on garde les plus récentes et on le dit. */
const MISSIONS_MAX = 30000;

/** Un intitulé plus long qu'une ligne de liste n'apporte rien de plus. */
const INTITULE_MAX = 90;

export async function getCouverture() {
  const db = getDb();
  const [rows, demiVieRows, agenceRows] = await Promise.all([
    db.select().from(schema.signal).where(eq(schema.signal.type, "MISSION_CONCURRENT")),
    db.select().from(schema.weights).where(eq(schema.weights.key, "sismo.demivie.MISSION_CONCURRENT")),
    db.select().from(schema.agence).limit(1),
  ]);

  /** Libellé métier tel que fourni par la source, prioritaire sur le dictionnaire local. */
  const libellesRome = new Map<string, string>();
  /** Variante d'affichage retenue pour chaque enseigne regroupée. */
  const libellesAgence = new Map<string, string>();
  const brutes: (MissionCouverture & { cleAgence: string })[] = [];

  for (const s of rows) {
    const commune = typeof s.payload?.commune === "string" ? (s.payload.commune as string) : "?";
    const rome = typeof s.payload?.rome === "string" ? (s.payload.rome as string) : "?";
    const agenceBrute =
      typeof s.payload?.agenceInterim === "string" && s.payload.agenceInterim.trim().length > 0
        ? (s.payload.agenceInterim as string).trim()
        : "Enseigne non précisée";
    const intitule =
      typeof s.payload?.intitule === "string" ? (s.payload.intitule as string) : "Mission d'intérim";
    if (typeof s.payload?.romeLibelle === "string" && s.payload.romeLibelle.length > 0) {
      libellesRome.set(rome, s.payload.romeLibelle as string);
    }
    // Les sources écrivent la même enseigne de plusieurs façons (« RANDSTAD »,
    // « Randstad », « Randstad SAS ») : on regroupe sur la dénomination
    // normalisée, et on affiche la variante la plus lisible.
    const cleAgence = normalizeDenomination(agenceBrute) || agenceBrute.toUpperCase();
    libellesAgence.set(cleAgence, casseEnseigne(agenceBrute));
    brutes.push({
      commune,
      rome,
      cleAgence,
      agence: "",
      intitule: intitule.slice(0, INTITULE_MAX),
      date: s.occurredAt,
    });
  }

  brutes.sort((a, b) => b.date.localeCompare(a.date));
  const tronque = brutes.length > MISSIONS_MAX;
  const missions: MissionCouverture[] = brutes.slice(0, MISSIONS_MAX).map((m) => ({
    commune: m.commune,
    rome: m.rome,
    agence: libellesAgence.get(m.cleAgence) ?? m.cleAgence,
    intitule: m.intitule,
    date: m.date,
  }));

  const agence = agenceRows[0];
  /* L'agence de l'utilisateur publie elle aussi sur France Travail : elle
     apparaît donc dans ses propres données de couverture. La reconnaître change
     tout le sens d'une case — présent ou absent là où les concurrents placent. */
  const cleAgenceUtilisateur = agence ? normalizeDenomination(agence.nom) : "";
  const enseigneAgence = cleAgenceUtilisateur
    ? (libellesAgence.get(cleAgenceUtilisateur) ?? null)
    : null;

  return {
    missions,
    enseigneAgence,
    /** Objet simple plutôt qu'une Map : la grille est un composant client. */
    libellesRome: Object.fromEntries(libellesRome),
    /** Métiers que l'agence place : ce qui distingue un angle mort d'un désert. */
    romeCibles: agence?.romeCibles ?? [],
    demiVie: demiVieRows[0]?.value ?? 60,
    total: rows.length,
    tronque,
  };
}

export type ResolutionEntree = typeof schema.resolutionQueue.$inferSelect & {
  /** Signal en attente de rattachement : son type et son contexte métier. */
  signal: {
    type: string;
    occurredAt: string;
    payload: Record<string, unknown> | null;
  } | null;
};

/**
 * File de rapprochement, avec le CONTEXTE du signal lié. Depuis que le BOAMP
 * alimente la file, le nom brut ne suffit plus : rapprocher « Aber propreté
 * azur SAS » sans savoir qu'il s'agit d'un marché de nettoyage pour la ville
 * de Vichy est beaucoup plus dur que de le lire avec son objet et son acheteur.
 */
export async function getResolutions(): Promise<ResolutionEntree[]> {
  const db = getDb();
  const rows = await db
    .select({ entree: schema.resolutionQueue, signal: schema.signal })
    .from(schema.resolutionQueue)
    .leftJoin(schema.signal, eq(schema.signal.id, schema.resolutionQueue.signalId))
    .orderBy(desc(schema.resolutionQueue.createdAt));

  return rows.map(({ entree, signal }) => ({
    ...entree,
    signal: signal
      ? { type: signal.type, occurredAt: signal.occurredAt, payload: signal.payload ?? null }
      : null,
  }));
}

export async function getIngestion() {
  const db = getDb();
  return db.select().from(schema.ingestionRun).orderBy(desc(schema.ingestionRun.startedAt)).limit(50);
}

/* ── Actualités du bassin ────────────────────────────────────────────
   Le fil de ce qui vient de se passer autour de l'agence, indépendamment
   du score : les marchés publics attribués (qui a gagné quoi, pour quel
   montant), les appels d'offres encore ouverts (ce qui va être attribué,
   et quand il faut être en face), et la vie des entreprises du bassin
   (effectifs, capital, résultats, accords, procédures collectives).

   Les offres d'emploi n'y figurent pas : elles sont le cœur des leads et
   des missions concurrentes, elles noieraient tout le reste. */

/** Vie des entreprises : registre, finances, accords, urbanisme. */
export const TYPES_VIE_ENTREPRISE = [
  "EFFECTIF_UP",
  "CA_CROISSANCE",
  "CA_BAISSE",
  "BODACC_CAPITAL",
  "BODACC_RISQUE",
  "ACCORD_SURCHARGE",
  "ACCORD_RESTRUCTURATION",
  "PERMIS_LOCAUX",
] as const;

const TYPES_ACTUALITES = ["MARCHE_ATTRIBUE", "AO_OUVERT", ...TYPES_VIE_ENTREPRISE];

/** Profondeur du fil : au-delà, ce n'est plus une actualité. */
const ACTUALITES_JOURS = 180;

export type RubriqueActualite = "attribue" | "a_venir" | "vie";

export type Actualite = {
  id: string;
  rubrique: RubriqueActualite;
  type: string;
  source: string;
  /** Date de l'événement chez la source : notification, parution, jugement. */
  date: string;
  /** Objet du marché — les rubriques « commande publique » seulement. */
  objet: string | null;
  /** Résumé français du signal, tel que l'affiche la chronologie d'une fiche. */
  resume: string;
  acheteur: string | null;
  montant: number | null;
  dureeMois: number | null;
  /** Appel d'offres : date limite de remise des plis. */
  dateLimite: string | null;
  procedure: string | null;
  urlAvis: string | null;
  /** Entreprise concernée, quand le signal est rapproché d'un établissement. */
  siret: string | null;
  denomination: string | null;
  commune: string | null;
  /** Nom brut du titulaire quand le rapprochement n'a pas abouti (BOAMP). */
  titulaireBrut: string | null;
  /** Score du lead existant : le fil renvoie vers la fiche quand il y en a une. */
  scoreFinal: number | null;
  distanceKm: number | null;
  /** Métiers induits, en clair — ce qu'il y aura à placer. */
  metiers: string[];
  /** Signal issu des fixtures de démonstration. */
  demo: boolean;
};

function texte(p: Record<string, unknown> | null, cle: string): string | null {
  const v = p?.[cle];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function nombre(p: Record<string, unknown> | null, cle: string): number | null {
  const v = p?.[cle];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* Un avis de consultation reste dans « à venir » même quelques jours après sa
   date limite : l'adapter BOAMP ne le garde qu'un mois de plus, et c'est
   précisément la période où l'attribution tombe. La ligne le dit alors
   « clôturé » plutôt que de disparaître. */
function rubriqueDe(type: string): RubriqueActualite {
  if (type === "AO_OUVERT") return "a_venir";
  return type === "MARCHE_ATTRIBUE" ? "attribue" : "vie";
}

export async function getActualites(jours = ACTUALITES_JOURS): Promise<Actualite[]> {
  const db = getDb();
  const depuis = new Date(Date.now() - jours * 86400000).toISOString();

  const [rows, agence] = await Promise.all([
    db
      .select({ signal: schema.signal, etab: schema.etablissement, lead: schema.lead })
      .from(schema.signal)
      .leftJoin(schema.etablissement, eq(schema.etablissement.siret, schema.signal.siret))
      .leftJoin(schema.lead, eq(schema.lead.siret, schema.signal.siret))
      .where(and(inArray(schema.signal.type, TYPES_ACTUALITES), gte(schema.signal.occurredAt, depuis)))
      .orderBy(desc(schema.signal.occurredAt)),
    getAgence(),
  ]);

  /* Le DECP ne publie pas le nom de l'acheteur, seulement son SIRET. Quand il
     se trouve dans le référentiel (les acheteurs publics du bassin y entrent
     par l'enrichissement SIRENE), on lui rend son nom ; sinon on affiche le
     SIRET plutôt que rien — c'est la clé qui permet de le retrouver. */
  const siretsAcheteurs = [
    ...new Set(
      rows
        .map((r) => texte(r.signal.payload ?? null, "acheteur"))
        .filter((s): s is string => !!s && /^\d{14}$/.test(s)),
    ),
  ];
  const nomsAcheteurs = new Map<string, string>();
  if (siretsAcheteurs.length > 0) {
    const acheteurs = await db
      .select({ siret: schema.etablissement.siret, denomination: schema.etablissement.denomination })
      .from(schema.etablissement)
      .where(inArray(schema.etablissement.siret, siretsAcheteurs));
    for (const a of acheteurs) nomsAcheteurs.set(a.siret, a.denomination);
  }

  return rows.map(({ signal, etab, lead }) => {
    const p = signal.payload ?? null;
    const acheteurBrut = texte(p, "acheteurNom") ?? texte(p, "acheteur");
    const dateLimite = texte(p, "dateLimite");

    return {
      id: signal.id,
      rubrique: rubriqueDe(signal.type),
      type: signal.type,
      source: signal.source,
      date: signal.occurredAt,
      objet: texte(p, "objet"),
      resume: resumeSignal({
        id: signal.id,
        type: signal.type,
        occurredAt: signal.occurredAt,
        confidence: signal.confidence,
        payload: p,
        lieu: signal.lieu ?? null,
        romes: signal.romes ?? null,
      }),
      acheteur: acheteurBrut ? (nomsAcheteurs.get(acheteurBrut) ?? acheteurBrut) : null,
      montant: nombre(p, "montant"),
      dureeMois: nombre(p, "dureeMois"),
      dateLimite,
      procedure: texte(p, "procedure"),
      urlAvis: texte(p, "urlAvis"),
      siret: signal.siret,
      denomination: etab?.denomination ?? null,
      commune: etab?.commune ?? null,
      titulaireBrut: etab ? null : texte(p, "titulaire"),
      scoreFinal: lead?.scoreFinal ?? null,
      distanceKm: etab ? distanceEtab(agence, etab) : null,
      metiers: (signal.romes ?? []).map(romeLabel).filter((l, i, tous) => tous.indexOf(l) === i),
      demo: signal.source.startsWith("fixture:"),
    };
  });
}
