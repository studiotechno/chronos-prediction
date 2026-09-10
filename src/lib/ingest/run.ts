/**
 * Exécuteur d'ingestion : itère un adapter, valide/normalise, écrit en base
 * de façon idempotente (unicité signal(source, raw_ref)), journalise dans
 * ingestion_run.
 *
 * Dérivées calculées ici, au moment où la donnée de référence change :
 *   · EFFECTIF_UP au ré-import SIRENE, quand la tranche stockée diffère ;
 *   · CA_CROISSANCE / CA_BAISSE quand deux exercices sont connus (RNE).
 *
 * Un signal qui arrive sans SIRET mais avec une raison sociale (titulaire BOAMP)
 * passe par le rapprocheur partagé ; ambigu, il va en file de résolution.
 */
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import * as schema from "../db/schema";
import { trancheRank } from "../reference/tranches";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "./types";
import type { IngestionError } from "../db/schema";
import { creerRapprocheur, type Rapprocheur } from "./rapprocher";

export type RunStats = {
  recordsIn: number;
  recordsOut: number;
  erreurs: IngestionError[];
  /** Rapprochements des signaux sans SIRET (BOAMP…). */
  rapprochement: { autos: number; autosViaSirene: number; ambigus: number; rejets: number };
};

/** Variation relative de CA à partir de laquelle on dérive un signal. */
const SEUIL_CA = 0.15;
/** Ouverture d'établissement : fenêtre d'observation, et ancienneté minimale de l'entreprise. */
const ETAB_NOUVEAU_JOURS = 180;
const ETAB_NOUVEAU_ANCIENNETE_JOURS = 365;
const JOUR_MS = 86400000;

type Finances = {
  caAnnee: number | null;
  ca: number | null;
  caPrecedent: number | null;
  resultatNet: number | null;
  resultatNetPrecedent: number | null;
};

/**
 * Dérivée CA_CROISSANCE / CA_BAISSE : deux exercices connus, variation ≥ 15 %.
 * Idempotente par rawRef quelle que soit la source qui apporte les comptes
 * (SIRENE n'en publie qu'un exercice, les ratios INPI plusieurs).
 */
async function deriverCa(
  db: PostgresJsDatabase<typeof schema>,
  siren: string,
  siretSiege: string | null,
  f: Finances,
  source: string,
  nowIso: string,
): Promise<boolean> {
  if (f.ca == null || f.caPrecedent == null || !(f.caPrecedent > 0) || f.caAnnee == null) return false;
  // Des comptes vieux de plus de trois ans ne disent plus rien du présent : un
  // « CA +34 % (exercice 2020) » n'est pas une raison d'appeler en 2026.
  if (f.caAnnee < new Date(nowIso).getUTCFullYear() - 3) return false;
  const delta = (f.ca - f.caPrecedent) / f.caPrecedent;
  if (Math.abs(delta) < SEUIL_CA) return false;
  const rawRef = `ca-${siren}-${f.caAnnee}`;
  const existant = await db.select({ id: schema.signal.id }).from(schema.signal).where(eq(schema.signal.rawRef, rawRef));
  if (existant.length > 0) return false;
  const inseres = await db
    .insert(schema.signal)
    .values({
      id: crypto.randomUUID(),
      siret: siretSiege,
      siren,
      type: delta > 0 ? "CA_CROISSANCE" : "CA_BAISSE",
      source,
      // Les comptes d'un exercice se déposent au milieu de l'année suivante.
      occurredAt: `${f.caAnnee + 1}-07-01T00:00:00.000Z`,
      ingestedAt: nowIso,
      confidence: 1,
      payload: {
        annee: f.caAnnee,
        ca: f.ca,
        caPrecedent: f.caPrecedent,
        deltaPct: Math.round(delta * 1000) / 10,
      },
      rawRef,
    })
    .onConflictDoNothing()
    .returning({ id: schema.signal.id });
  return inseres.length > 0;
}

/**
 * Ouverture d'établissement : une entreprise établie depuis plus d'un an démarre
 * un site sur le bassin. Le recrutement suit l'ouverture — noyau à retard.
 * Une entreprise qui vient de naître n'est pas une implantation.
 */
export function estOuvertureRecente(
  etab: { dateDebutActivite?: string | null; etatAdministratif: string | null },
  entreprise: { dateCreation: string | null },
  now: Date,
): boolean {
  if (etab.etatAdministratif !== "A" || !etab.dateDebutActivite || !entreprise.dateCreation) return false;
  const debut = new Date(etab.dateDebutActivite).getTime();
  const creation = new Date(entreprise.dateCreation).getTime();
  if (!Number.isFinite(debut) || !Number.isFinite(creation)) return false;
  const age = (now.getTime() - debut) / JOUR_MS;
  if (age < 0 || age > ETAB_NOUVEAU_JOURS) return false;
  return (debut - creation) / JOUR_MS >= ETAB_NOUVEAU_ANCIENNETE_JOURS;
}

/**
 * Fusion des finances au ré-import d'une source qui n'en publie qu'un exercice
 * (SIRENE) avec celles d'une source qui en publie plusieurs (INPI) : l'exercice le
 * plus récent gagne, un exercice précédent connu n'est jamais effacé par un null,
 * et un exercice qui avance d'un an fait glisser l'ancien « dernier » en « précédent ».
 * Colonnes brutes : ON CONFLICT ne connaît que `excluded` et la table.
 */
export function fusionFinancesSql() {
  const t = sql.raw('"entreprise"');
  return {
    caAnnee: sql`CASE WHEN excluded.ca_annee IS NULL THEN ${t}.ca_annee
      WHEN ${t}.ca_annee IS NULL OR excluded.ca_annee >= ${t}.ca_annee THEN excluded.ca_annee
      ELSE ${t}.ca_annee END`,
    ca: sql`CASE WHEN excluded.ca_annee IS NULL THEN ${t}.ca
      WHEN ${t}.ca_annee IS NULL OR excluded.ca_annee > ${t}.ca_annee THEN excluded.ca
      WHEN excluded.ca_annee = ${t}.ca_annee THEN coalesce(excluded.ca, ${t}.ca)
      ELSE ${t}.ca END`,
    caPrecedent: sql`CASE WHEN excluded.ca_annee IS NULL THEN ${t}.ca_precedent
      WHEN ${t}.ca_annee IS NULL THEN excluded.ca_precedent
      WHEN excluded.ca_annee = ${t}.ca_annee + 1 THEN coalesce(excluded.ca_precedent, ${t}.ca)
      WHEN excluded.ca_annee = ${t}.ca_annee THEN coalesce(excluded.ca_precedent, ${t}.ca_precedent)
      WHEN excluded.ca_annee > ${t}.ca_annee THEN excluded.ca_precedent
      ELSE ${t}.ca_precedent END`,
    resultatNet: sql`CASE WHEN excluded.ca_annee IS NULL THEN ${t}.resultat_net
      WHEN ${t}.ca_annee IS NULL OR excluded.ca_annee > ${t}.ca_annee THEN excluded.resultat_net
      WHEN excluded.ca_annee = ${t}.ca_annee THEN coalesce(excluded.resultat_net, ${t}.resultat_net)
      ELSE ${t}.resultat_net END`,
    resultatNetPrecedent: sql`CASE WHEN excluded.ca_annee IS NULL THEN ${t}.resultat_net_precedent
      WHEN ${t}.ca_annee IS NULL THEN excluded.resultat_net_precedent
      WHEN excluded.ca_annee = ${t}.ca_annee + 1 THEN coalesce(excluded.resultat_net_precedent, ${t}.resultat_net)
      WHEN excluded.ca_annee = ${t}.ca_annee THEN coalesce(excluded.resultat_net_precedent, ${t}.resultat_net_precedent)
      WHEN excluded.ca_annee > ${t}.ca_annee THEN excluded.resultat_net_precedent
      ELSE ${t}.resultat_net_precedent END`,
  };
}

export async function runIngestion<TRaw>(
  db: PostgresJsDatabase<typeof schema>,
  adapter: SourceAdapter<TRaw>,
  params: FetchParams,
): Promise<RunStats> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db
    .insert(schema.ingestionRun)
    .values({ id: runId, source: adapter.id, startedAt, recordsIn: 0, recordsOut: 0, errors: [] });

  const stats: RunStats = {
    recordsIn: 0,
    recordsOut: 0,
    erreurs: [],
    rapprochement: { autos: 0, autosViaSirene: 0, ambigus: 0, rejets: 0 },
  };
  let rapprocheur: Rapprocheur | null = null;
  const obtenirRapprocheur = async () => (rapprocheur ??= await creerRapprocheur(db));

  try {
    for await (const raw of adapter.fetch(params)) {
      stats.recordsIn++;
      let records: NormalizedRecord[];
      try {
        records = adapter.normalize(raw);
      } catch (e) {
        stats.erreurs.push({ message: e instanceof Error ? e.message : String(e) });
        continue;
      }
      for (const record of records) {
        try {
          if (await appliquer(db, record, stats, obtenirRapprocheur)) stats.recordsOut++;
        } catch (e) {
          stats.erreurs.push({ message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } finally {
    await db
      .update(schema.ingestionRun)
      .set({
        finishedAt: new Date().toISOString(),
        recordsIn: stats.recordsIn,
        recordsOut: stats.recordsOut,
        errors: stats.erreurs.slice(0, 100),
      })
      .where(eq(schema.ingestionRun.id, runId));
  }

  return stats;
}

function estTrancheConnue(t: string | null | undefined): boolean {
  return !!t && t !== "NN";
}

/** Applique un enregistrement normalisé. Renvoie true si quelque chose a été écrit. */
async function appliquer(
  db: PostgresJsDatabase<typeof schema>,
  record: NormalizedRecord,
  stats: RunStats,
  obtenirRapprocheur: () => Promise<Rapprocheur>,
): Promise<boolean> {
  const nowIso = new Date().toISOString();

  if (record.kind === "etablissement") {
    const { entreprise, etablissement } = record;

    await db
      .insert(schema.entreprise)
      .values(entreprise)
      .onConflictDoUpdate({
        target: schema.entreprise.siren,
        set: {
          denomination: entreprise.denomination,
          categorie: entreprise.categorie,
          etat: entreprise.etat,
          ...(entreprise.caractereEmployeur !== undefined && { caractereEmployeur: entreprise.caractereEmployeur }),
          ...(entreprise.nbEtabsOuverts !== undefined && { nbEtabsOuverts: entreprise.nbEtabsOuverts }),
          ...(entreprise.caAnnee !== undefined && fusionFinancesSql()),
          ...(entreprise.idcc !== undefined && { idcc: entreprise.idcc }),
          ...(entreprise.complements !== undefined && { complements: entreprise.complements }),
        },
      });

    // Dérivée CA_CROISSANCE / CA_BAISSE : deux exercices connus (idempotent par rawRef)
    await deriverCa(
      db,
      entreprise.siren,
      etablissement.estSiege ? etablissement.siret : null,
      {
        caAnnee: entreprise.caAnnee ?? null,
        ca: entreprise.ca ?? null,
        caPrecedent: entreprise.caPrecedent ?? null,
        resultatNet: entreprise.resultatNet ?? null,
        resultatNetPrecedent: entreprise.resultatNetPrecedent ?? null,
      },
      "sirene",
      nowIso,
    );

    // Dérivée ETAB_NOUVEAU : ouverture récente d'un site par une entreprise établie
    if (estOuvertureRecente(etablissement, entreprise, new Date(nowIso))) {
      await db
        .insert(schema.signal)
        .values({
          id: crypto.randomUUID(),
          siret: etablissement.siret,
          siren: etablissement.siren,
          type: "ETAB_NOUVEAU",
          source: "sirene",
          occurredAt: `${etablissement.dateDebutActivite!.slice(0, 10)}T00:00:00.000Z`,
          ingestedAt: nowIso,
          confidence: 1,
          payload: {
            commune: etablissement.commune,
            naf: etablissement.naf,
            estSiege: etablissement.estSiege === 1,
            dateCreationEntreprise: entreprise.dateCreation,
          },
          rawRef: `etab-nouveau-${etablissement.siret}`,
          lieu:
            etablissement.lat != null && etablissement.lon != null
              ? { lat: etablissement.lat, lon: etablissement.lon, libelle: etablissement.commune }
              : null,
        })
        .onConflictDoNothing();
    }

    const existant = (
      await db
        .select()
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siret, etablissement.siret))
    )[0];

    // Dérivée EFFECTIF_UP : passage à une tranche supérieure entre deux imports
    if (
      estTrancheConnue(existant?.trancheEffectif) &&
      estTrancheConnue(etablissement.trancheEffectif) &&
      trancheRank(etablissement.trancheEffectif!) > trancheRank(existant!.trancheEffectif!)
    ) {
      await db
        .insert(schema.signal)
        .values({
          id: crypto.randomUUID(),
          siret: etablissement.siret,
          siren: etablissement.siren,
          type: "EFFECTIF_UP",
          source: "sirene",
          occurredAt: nowIso,
          ingestedAt: nowIso,
          confidence: 1,
          payload: {
            trancheAvant: existant!.trancheEffectif,
            trancheApres: etablissement.trancheEffectif,
          },
          rawRef: `effectif-${etablissement.siret}-${etablissement.trancheEffectif}`,
        })
        .onConflictDoNothing();
    }

    // Une tranche vue chez France Travail ne s'efface pas par un « NN » de l'INSEE.
    const garderTrancheFT =
      existant?.trancheEffectifSource === "francetravail" && !estTrancheConnue(etablissement.trancheEffectif);
    const valeurs = {
      ...etablissement,
      trancheEffectifSource: estTrancheConnue(etablissement.trancheEffectif)
        ? (etablissement.trancheEffectifSource ?? "sirene")
        : null,
      // Attributs posés par d'autres sources (ICPE, LBB) : jamais écrasés par un ré-import SIRENE.
      icpe: existant?.icpe ?? 0,
      icpeRegime: existant?.icpeRegime ?? null,
      lbbScore: existant?.lbbScore ?? null,
      lbbMaj: existant?.lbbMaj ?? null,
    };
    if (garderTrancheFT) {
      valeurs.trancheEffectif = existant!.trancheEffectif;
      valeurs.trancheEffectifSource = existant!.trancheEffectifSource;
      valeurs.effectifEstime = existant!.effectifEstime;
    }

    await db
      .insert(schema.etablissement)
      .values(valeurs)
      .onConflictDoUpdate({ target: schema.etablissement.siret, set: { ...valeurs } });
    return true;
  }

  if (record.kind === "signal") {
    const { rapprochement, ...signal } = record.signal;

    // Rapprochement par raison sociale (source sans SIRET).
    let resolutionEnAttente: { candidats: schema.CandidatResolution[] } | null = null;
    if (!signal.siret && rapprochement?.denomination) {
      const r = await (await obtenirRapprocheur()).rapprocher(rapprochement);
      if (r.decision === "auto") {
        signal.siret = r.siret;
        signal.siren = r.siren;
        signal.confidence = Math.min(signal.confidence, r.confidence);
        stats.rapprochement.autos++;
        if (r.viaSirene) stats.rapprochement.autosViaSirene++;
      } else if (r.decision === "ambigu") {
        stats.rapprochement.ambigus++;
        resolutionEnAttente = {
          candidats: r.candidats.map((c) => ({
            siret: c.siret,
            denomination: c.denomination,
            commune: c.commune,
            naf: c.naf,
            similarite: c.similarite,
          })),
        };
      } else {
        stats.rapprochement.rejets++;
      }
    }

    // Rattachement SIREN → siège : un signal BODACC ne porte qu'un SIREN.
    // On l'accroche au siège si l'entreprise est dans le référentiel du bassin,
    // sinon il reste sans SIRET — le scoring le rattachera si l'entreprise arrive plus tard.
    if (!signal.siret && signal.siren) {
      const etabs = await db
        .select({ siret: schema.etablissement.siret, estSiege: schema.etablissement.estSiege })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siren, signal.siren));
      signal.siret = etabs.find((e) => e.estSiege === 1)?.siret ?? etabs[0]?.siret ?? null;
    }

    const id = crypto.randomUUID();
    // Un signal déjà en base (même source, même référence) est RAFRAÎCHI : date,
    // payload, lieu, métiers — un avis BOAMP relu avec son montant et son code
    // postal ne doit pas rester figé dans sa première version. Le SIRET n'est
    // jamais effacé : une résolution manuelle survit à une ré-ingestion.
    // `xmax = 0` distingue l'insertion de la mise à jour.
    const ecrits = await db
      .insert(schema.signal)
      .values({ id, ingestedAt: nowIso, ...signal })
      .onConflictDoUpdate({
        target: [schema.signal.source, schema.signal.rawRef],
        set: {
          occurredAt: sql`excluded.occurred_at`,
          payload: sql`excluded.payload`,
          lieu: sql`excluded.lieu`,
          romes: sql`excluded.romes`,
          siret: sql`coalesce(${schema.signal.siret}, excluded.siret)`,
          siren: sql`coalesce(${schema.signal.siren}, excluded.siren)`,
        },
      })
      .returning({ id: schema.signal.id, nouveau: sql<boolean>`(xmax = 0)` });
    const inseres = ecrits.filter((e) => e.nouveau);

    if (inseres.length > 0 && resolutionEnAttente && rapprochement) {
      await db
        .insert(schema.resolutionQueue)
        .values({
          id: `match-${signal.source}-${signal.rawRef}`.slice(0, 120),
          source: signal.source,
          rawDenomination: rapprochement.denomination,
          rawCodePostal: rapprochement.codePostal ?? null,
          rawNaf: rapprochement.naf ?? null,
          candidats: resolutionEnAttente.candidats,
          statut: "en_attente",
          resolvedSiret: null,
          signalId: id,
          createdAt: nowIso,
        })
        .onConflictDoNothing();
    }
    return inseres.length > 0;
  }

  if (record.kind === "offre") {
    const o = record.offre;
    const existante = (
      await db
        .select({
          id: schema.offreBrute.id,
          dateActualisation: schema.offreBrute.dateActualisation,
          nbActualisations: schema.offreBrute.nbActualisations,
          payload: schema.offreBrute.payload,
          firstSeenAt: schema.offreBrute.firstSeenAt,
        })
        .from(schema.offreBrute)
        .where(eq(schema.offreBrute.id, o.id))
    )[0];
    if (existante) {
      // Une offre revue est rafraîchie : payload et champs dérivés compris, sinon
      // une offre importée avant l'ajout d'un champ resterait aveugle pour toujours.
      const reactualisee =
        !!o.dateActualisation && !!existante.dateActualisation && o.dateActualisation > existante.dateActualisation;
      // France Travail pose le drapeau « manque de candidats » avec retard, après
      // des semaines sur le marché : le signal se date au jour où on l'a VU
      // apparaître, pas à la publication (mesuré le 10/09/2026 : 0 offre de
      // septembre le portait, 92 d'août).
      const dejaDepuis = (existante.payload as { manqueCandidatsDepuis?: string | null } | null)?.manqueCandidatsDepuis;
      const manqueCandidatsDepuis = o.manqueCandidats ? (dejaDepuis ?? existante.firstSeenAt ?? nowIso) : null;
      await db
        .update(schema.offreBrute)
        .set({
          lastSeenAt: nowIso,
          closedAt: null,
          payload: { ...o.payload, manqueCandidatsDepuis },
          codeInsee: o.codeInsee ?? null,
          lat: o.lat ?? null,
          lon: o.lon ?? null,
          nombrePostes: o.nombrePostes ?? null,
          manqueCandidats: o.manqueCandidats ?? 0,
          trancheEffectifEtab: o.trancheEffectifEtab ?? null,
          dateActualisation: o.dateActualisation ?? existante.dateActualisation,
          nbActualisations: (existante.nbActualisations ?? 0) + (reactualisee ? 1 : 0),
          typeContrat: o.typeContrat,
          dureeContratJours: o.dureeContratJours,
          rome: o.rome,
          intitule: o.intitule,
        })
        .where(eq(schema.offreBrute.id, o.id));
      return false;
    }
    await db.insert(schema.offreBrute).values({
      id: o.id,
      siret: o.siret,
      entrepriseNom: o.entrepriseNom,
      intitule: o.intitule,
      typeContrat: o.typeContrat,
      dureeContratJours: o.dureeContratJours,
      rome: o.rome,
      codePostal: o.codePostal,
      commune: o.commune,
      codeInsee: o.codeInsee ?? null,
      lat: o.lat ?? null,
      lon: o.lon ?? null,
      parAgenceInterim: o.parAgenceInterim,
      datePublication: o.datePublication,
      dateActualisation: o.dateActualisation ?? null,
      // Une offre déjà actualisée à sa première lecture compte une actualisation.
      nbActualisations:
        o.dateActualisation && o.dateActualisation.slice(0, 10) > o.datePublication.slice(0, 10) ? 1 : 0,
      nombrePostes: o.nombrePostes ?? null,
      manqueCandidats: o.manqueCandidats ?? 0,
      trancheEffectifEtab: o.trancheEffectifEtab ?? null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      closedAt: null,
      source: o.source,
      payload: { ...o.payload, manqueCandidatsDepuis: o.manqueCandidats ? nowIso : null },
    });
    return true;
  }

  if (record.kind === "finances") {
    const connue = (
      await db
        .select({ siren: schema.entreprise.siren })
        .from(schema.entreprise)
        .where(eq(schema.entreprise.siren, record.siren))
    )[0];
    if (!connue) return false;
    const f = record.finances;
    await db
      .update(schema.entreprise)
      .set({
        caAnnee: f.caAnnee,
        ca: f.ca,
        caPrecedent: f.caPrecedent,
        resultatNet: f.resultatNet,
        resultatNetPrecedent: f.resultatNetPrecedent,
      })
      .where(eq(schema.entreprise.siren, record.siren));
    const etabs = await db
      .select({ siret: schema.etablissement.siret, estSiege: schema.etablissement.estSiege })
      .from(schema.etablissement)
      .where(eq(schema.etablissement.siren, record.siren));
    const siege = etabs.find((e) => e.estSiege === 1)?.siret ?? etabs[0]?.siret ?? null;
    await deriverCa(db, record.siren, siege, f, record.source, nowIso);
    return true;
  }

  if (record.kind === "attribut") {
    const existant = (
      await db
        .select({ siret: schema.etablissement.siret, trancheEffectif: schema.etablissement.trancheEffectif })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siret, record.siret))
    )[0];
    if (!existant) return false;
    const a = record.attributs;
    const set: Partial<typeof schema.etablissement.$inferInsert> = {};
    if (a.icpe !== undefined) set.icpe = a.icpe;
    if (a.icpeRegime !== undefined) set.icpeRegime = a.icpeRegime;
    if (a.lbbScore !== undefined) set.lbbScore = a.lbbScore;
    if (a.lbbMaj !== undefined) set.lbbMaj = a.lbbMaj;
    // Une tranche apportée par une autre source ne remplace jamais une tranche INSEE connue.
    if (a.trancheEffectif !== undefined && !estTrancheConnue(existant.trancheEffectif) && estTrancheConnue(a.trancheEffectif)) {
      set.trancheEffectif = a.trancheEffectif;
      set.trancheEffectifSource = a.trancheEffectifSource ?? null;
      const { effectifEstime } = await import("../reference/tranches");
      set.effectifEstime = effectifEstime(a.trancheEffectif);
    }
    if (Object.keys(set).length === 0) return false;
    await db.update(schema.etablissement).set(set).where(eq(schema.etablissement.siret, record.siret));
    return true;
  }

  return false;
}
