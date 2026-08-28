/**
 * Dérivation des signaux France Travail à partir du staging offre_brute.
 * Un signal n'est JAMAIS une offre recopiée : c'est une dérivée calculée
 * (republication, vélocité, CDD répétés, réactualisation, manque de candidats,
 * multipostes, mission concurrente).
 *
 * Chaque signal d'offre porte le LIEU DU BESOIN (le lieu de travail, pas le
 * siège) et le métier ROME induit : le moteur mesure la distance au chantier
 * et propose un métier au téléphone.
 *
 * Cœur pur et testable (deriveSignaux) + enveloppe base (deriveEtEnregistrer).
 * Limite documentée (cold start) : OFFRE_REPUBLIEE et OFFRE_VELOCITE ne
 * deviennent fiables qu'après plusieurs semaines d'ingestion régulière,
 * puisqu'une offre clôturée disparaît de l'API. OFFRE_REACTUALISEE contourne
 * ce cold start : la source publie `dateActualisation`, et une offre non
 * pourvue est réactualisée par l'employeur. Voir docs/sources.md.
 */
import { eq, notLike } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import * as schema from "../db/schema";
import { chunk } from "../db/chunk";
import { effectifEstime } from "../reference/tranches";
import { creerRapprocheur } from "./rapprocher";
import type { SignalLieu } from "./types";

export type OffreLike = {
  id: string;
  siret: string | null;
  entrepriseNom: string | null;
  intitule: string;
  typeContrat: string | null;
  dureeContratJours: number | null;
  rome: string | null;
  codePostal: string | null;
  commune: string | null;
  codeInsee?: string | null;
  lat?: number | null;
  lon?: number | null;
  parAgenceInterim: number;
  datePublication: string;
  dateActualisation?: string | null;
  nbActualisations?: number | null;
  nombrePostes?: number | null;
  manqueCandidats?: number | null;
  trancheEffectifEtab?: string | null;
  closedAt: string | null;
  /** Métadonnées de la source (codeNAF, romeLibelle) — jamais de donnée personnelle. */
  payload?: Record<string, unknown> | null;
};

export type RapprochementStats = {
  autos: number;
  /** Part des rattachements obtenus en interrogeant SIRENE (passe 2). */
  autosViaSirene: number;
  ambigus: number;
  rejets: number;
  /** Offres écartées avant tout appel réseau : NAF hors divisions cibles. */
  horsCible: number;
  /** Tranches d'effectif publiées par France Travail propagées à des établissements qui n'en avaient pas. */
  tranchesPropagees: number;
};

export type SignalDraft = {
  siret: string | null;
  siren: string | null;
  type: string;
  source: string;
  occurredAt: string;
  confidence: number;
  payload: Record<string, unknown>;
  rawRef: string;
  lieu: SignalLieu | null;
  romes: string[] | null;
};

const JOUR_MS = 86400000;

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

/** Lieu du besoin : le lieu de travail de l'offre, quand la source le géolocalise. */
export function lieuDe(o: OffreLike): SignalLieu | null {
  if (typeof o.lat !== "number" || typeof o.lon !== "number") return null;
  if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
  return { lat: o.lat, lon: o.lon, libelle: o.commune ?? null };
}

/**
 * Libellé métier publié par France Travail. Le projet a déjà tranché pour la
 * carte de couverture : c'est la source qui nomme les métiers, pas un
 * dictionnaire ROME local forcément incomplet. Sans lui, la proposition
 * d'appel affiche des codes bruts (« proposer : i1613, n4109 »).
 */
export function romeLibelleDe(o: OffreLike): string | null {
  return (o.payload as { romeLibelle?: string | null } | null)?.romeLibelle ?? null;
}

function romesDe(o: OffreLike): string[] | null {
  return o.rome ? [o.rome] : null;
}

export function deriveSignaux(offres: OffreLike[], now: Date): SignalDraft[] {
  const signaux: SignalDraft[] = [];
  const nowMs = now.getTime();
  const ageJours = (iso: string) => (nowMs - new Date(iso).getTime()) / JOUR_MS;

  // ---------------------------------------------------------------- MISSION_CONCURRENT
  // Offres MIS postées par des agences : cartographie de couverture, siret volontairement nul.
  for (const o of offres) {
    if (o.parAgenceInterim !== 1) continue;
    if (ageJours(o.datePublication) > 90) continue;
    signaux.push({
      siret: null,
      siren: null,
      type: "MISSION_CONCURRENT",
      source: "francetravail",
      occurredAt: o.datePublication,
      confidence: 1,
      payload: {
        offreId: o.id,
        intitule: o.intitule,
        rome: o.rome,
        romeLibelle: (o.payload as { romeLibelle?: string | null } | null)?.romeLibelle ?? null,
        commune: o.commune,
        codePostal: o.codePostal,
        agenceInterim: o.entrepriseNom,
      },
      rawRef: `mission-${o.id}`,
      lieu: lieuDe(o),
      romes: romesDe(o),
    });
  }

  // Le reste ne concerne que les offres d'entreprises (pas d'agences) rattachées à un SIRET.
  const directes = offres.filter((o) => o.parAgenceInterim !== 1 && o.siret);
  const parSiret = new Map<string, OffreLike[]>();
  for (const o of directes) {
    const liste = parSiret.get(o.siret!) ?? [];
    liste.push(o);
    parSiret.set(o.siret!, liste);
  }

  for (const [siret, liste] of parSiret) {
    const siren = siret.slice(0, 9);

    for (const o of liste) {
      if (ageJours(o.datePublication) > 90) continue;
      const base = { siret, siren, source: "francetravail", confidence: 0.95, lieu: lieuDe(o), romes: romesDe(o) };

      // ------------------------------------------------------------ OFFRE_DIRECTE
      signaux.push({
        ...base,
        type: "OFFRE_DIRECTE",
        occurredAt: o.datePublication,
        payload: { offreId: o.id, intitule: o.intitule, rome: o.rome, romeLibelle: romeLibelleDe(o), typeContrat: o.typeContrat },
        rawRef: `directe-${o.id}`,
      });

      // ------------------------------------------------------------ OFFRE_MANQUE_CANDIDATS
      // France Travail lui-même signale l'offre comme difficile à pourvoir.
      if (o.manqueCandidats === 1) {
        signaux.push({
          ...base,
          type: "OFFRE_MANQUE_CANDIDATS",
          occurredAt: o.datePublication,
          payload: { offreId: o.id, intitule: o.intitule, rome: o.rome, romeLibelle: romeLibelleDe(o), typeContrat: o.typeContrat },
          rawRef: `manque-${o.id}`,
        });
      }

      // ------------------------------------------------------------ OFFRE_MULTIPOSTES
      // Plusieurs postes sur une même offre : un recrutement de volume, pas un remplacement.
      if (o.nombrePostes != null && o.nombrePostes >= 2) {
        signaux.push({
          ...base,
          type: "OFFRE_MULTIPOSTES",
          occurredAt: o.datePublication,
          payload: { offreId: o.id, intitule: o.intitule, rome: o.rome, romeLibelle: romeLibelleDe(o), nombrePostes: o.nombrePostes },
          rawRef: `multi-${o.id}`,
        });
      }

      // ------------------------------------------------------------ OFFRE_REACTUALISEE
      // Réactualisée au moins deux fois : elle ne se pourvoit pas. Chaque nouvelle
      // actualisation crée un signal daté du jour de l'actualisation ; l'ancien décroît.
      if (o.nbActualisations != null && o.nbActualisations >= 2) {
        signaux.push({
          ...base,
          type: "OFFRE_REACTUALISEE",
          occurredAt: o.dateActualisation ?? o.datePublication,
          payload: {
            offreId: o.id,
            intitule: o.intitule,
            rome: o.rome,
            romeLibelle: romeLibelleDe(o),
            nbActualisations: o.nbActualisations,
            premierePublication: o.datePublication,
          },
          rawRef: `reactu-${o.id}-${o.nbActualisations}`,
        });
      }
    }

    // ------------------------------------------------------------ OFFRE_REPUBLIEE
    // Même intitulé + même SIRET, republié après clôture d'une occurrence précédente.
    const parIntitule = new Map<string, OffreLike[]>();
    for (const o of liste) {
      const cle = slug(o.intitule);
      const g = parIntitule.get(cle) ?? [];
      g.push(o);
      parIntitule.set(cle, g);
    }
    for (const [cleIntitule, groupe] of parIntitule) {
      if (groupe.length < 2) continue;
      const triees = [...groupe].sort((a, b) => a.datePublication.localeCompare(b.datePublication));
      const republications = triees.slice(1).filter((_, i) => triees[i].closedAt != null).length;
      if (republications === 0) continue;
      const derniere = triees[triees.length - 1];
      if (ageJours(derniere.datePublication) > 90) continue;
      signaux.push({
        siret,
        siren,
        type: "OFFRE_REPUBLIEE",
        source: "francetravail",
        occurredAt: derniere.datePublication,
        confidence: 0.95,
        payload: {
          offreId: derniere.id,
          intitule: derniere.intitule,
          rome: derniere.rome,
          nbRepublications: republications + 1,
          premierePublication: triees[0].datePublication,
        },
        rawRef: `repub-${siret}-${cleIntitule}-${triees.length}`,
        lieu: lieuDe(derniere),
        romes: romesDe(derniere),
      });
    }

    // ------------------------------------------------------------ CDD_COURT_REPETE
    // Au moins 3 CDD de moins de 3 mois sur 60 jours.
    const cddCourts = liste.filter(
      (o) =>
        o.typeContrat === "CDD" &&
        o.dureeContratJours != null &&
        o.dureeContratJours < 90 &&
        ageJours(o.datePublication) <= 60,
    );
    if (cddCourts.length >= 3) {
      const plusRecente = cddCourts.reduce((a, b) => (a.datePublication > b.datePublication ? a : b));
      const dureeMoy = Math.round(
        cddCourts.reduce((s, o) => s + (o.dureeContratJours ?? 0), 0) / cddCourts.length,
      );
      signaux.push({
        siret,
        siren,
        type: "CDD_COURT_REPETE",
        source: "francetravail",
        occurredAt: plusRecente.datePublication,
        confidence: 0.95,
        payload: { nbCdd: cddCourts.length, fenetreJours: 60, dureeMoyenneJours: dureeMoy },
        rawRef: `cddcourt-${siret}-${now.toISOString().slice(0, 7)}`,
        lieu: lieuDe(plusRecente),
        romes: [...new Set(cddCourts.map((o) => o.rome).filter((r): r is string => !!r))],
      });
    }

    // ------------------------------------------------------------ OFFRE_VELOCITE
    // Volume sur 14 jours glissants > baseline 90 jours + 2 écarts-types.
    const recentes = liste.filter((o) => ageJours(o.datePublication) <= 14);
    const n14 = recentes.length;
    if (n14 >= 3) {
      // Baseline : fenêtres de 14 jours sur les jours 15 à 104 (6 fenêtres)
      const fenetres: number[] = [];
      for (let f = 1; f <= 6; f++) {
        const debut = f * 14;
        const fin = debut + 14;
        fenetres.push(
          liste.filter((o) => {
            const a = ageJours(o.datePublication);
            return a > debut && a <= fin;
          }).length,
        );
      }
      const moyenne = fenetres.reduce((s, x) => s + x, 0) / fenetres.length;
      const variance = fenetres.reduce((s, x) => s + (x - moyenne) ** 2, 0) / fenetres.length;
      const ecartType = Math.sqrt(variance);
      const seuil = moyenne + 2 * Math.max(0.5, ecartType); // plancher pour éviter σ=0
      if (n14 > seuil) {
        const plusRecente = recentes.reduce((a, b) => (a.datePublication > b.datePublication ? a : b));
        signaux.push({
          siret,
          siren,
          type: "OFFRE_VELOCITE",
          source: "francetravail",
          occurredAt: now.toISOString(),
          confidence: 0.9,
          payload: {
            nbOffres14j: n14,
            baselineMoyenne: Math.round(moyenne * 10) / 10,
            ecartsTypes: ecartType > 0 ? Math.round(((n14 - moyenne) / ecartType) * 10) / 10 : null,
          },
          rawRef: `velocite-${siret}-${semaineIso(now)}`,
          lieu: lieuDe(plusRecente),
          romes: [...new Set(recentes.map((o) => o.rome).filter((r): r is string => !!r))],
        });
      }
    }
  }

  return signaux;
}

function semaineIso(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const debutAnnee = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const semaine = Math.ceil(((date.getTime() - debutAnnee.getTime()) / JOUR_MS + 1) / 7);
  return `${date.getUTCFullYear()}-S${String(semaine).padStart(2, "0")}`;
}

/** Division NAF (2 chiffres) d'un code NAF complet. */
function division(naf: string | null | undefined): string | null {
  if (!naf) return null;
  const d = naf.replace(/[^0-9]/g, "").slice(0, 2);
  return d.length === 2 ? d : null;
}

function estTrancheConnue(t: string | null | undefined): boolean {
  return !!t && t !== "NN";
}

/**
 * Rapprochement des offres sans SIRET. France Travail ne publie JAMAIS le SIRET
 * de l'employeur (vérifié : 0 offre sur 150) : ce rapprochement est donc le chemin
 * normal de la source la plus importante du système, pas un cas limite.
 *
 * Le rapprocheur partagé (src/lib/ingest/rapprocher.ts) fait les deux passes :
 *   1. contre le référentiel local, enseignes comprises (gratuit, instantané) ;
 *   2. si aucun rattachement automatique, interrogation de SIRENE par raison
 *      sociale + département, dont les candidats repassent par le même scoring.
 *
 * Garde-fou de volumétrie : seules les offres dont le NAF (fourni par France Travail)
 * appartient aux divisions cibles de l'agence déclenchent un appel réseau. Inutile
 * d'interroger SIRENE pour une offre de supermarché ou d'assurance.
 *
 * Décisions : ≥ 0.88 rattachement automatique, 0.62-0.88 file de résolution
 * manuelle, en dessous rejet compté.
 *
 * Après rattachement, la tranche d'effectif publiée par France Travail est
 * propagée à l'établissement quand l'INSEE n'en publie pas (82 % des cas).
 */
async function rapprocherOffresSansSiret(
  db: PostgresJsDatabase<typeof schema>,
  offres: (typeof schema.offreBrute.$inferSelect)[],
  now: Date,
): Promise<RapprochementStats> {
  const stats: RapprochementStats = {
    autos: 0,
    autosViaSirene: 0,
    ambigus: 0,
    rejets: 0,
    horsCible: 0,
    tranchesPropagees: 0,
  };

  const aTraiter = offres.filter((o) => o.parAgenceInterim !== 1 && !o.siret && o.entrepriseNom);
  const rattachees = offres.filter((o) => o.parAgenceInterim !== 1 && o.siret);

  const agence = (await db.select().from(schema.agence).limit(1))[0];
  const divisionsCibles = new Set(
    (agence?.nafCibles ?? []).map((n) => n.replace(/[^0-9]/g, "").slice(0, 2)),
  );

  const nowIso = now.toISOString();

  const rattacher = async (o: (typeof schema.offreBrute.$inferSelect), siret: string) => {
    await db.update(schema.offreBrute).set({ siret }).where(eq(schema.offreBrute.id, o.id));
    o.siret = siret; // la dérivation qui suit en profite immédiatement
  };

  const mettreEnFile = async (
    o: (typeof schema.offreBrute.$inferSelect),
    candidats: { siret: string; denomination: string; commune: string | null; naf: string | null; similarite: number }[],
  ) => {
    const pendingId = `match-sig-${o.id}`;
    await db
      .insert(schema.signal)
      .values({
        id: pendingId,
        siret: null,
        siren: null,
        type: "OFFRE_DIRECTE",
        source: "francetravail",
        occurredAt: o.datePublication,
        ingestedAt: nowIso,
        confidence: candidats[0]?.similarite ?? 0.7,
        payload: {
          offreId: o.id,
          intitule: o.intitule,
          rome: o.rome,
          romeLibelle: romeLibelleDe(o),
          typeContrat: o.typeContrat,
          entrepriseNom: o.entrepriseNom,
        },
        rawRef: `pending-directe-${o.id}`,
        lieu: lieuDe(o),
        romes: o.rome ? [o.rome] : null,
      })
      .onConflictDoNothing();
    await db
      .insert(schema.resolutionQueue)
      .values({
        id: `match-${o.id}`,
        source: "francetravail",
        rawDenomination: o.entrepriseNom!,
        rawCodePostal: o.codePostal,
        rawNaf: (o.payload as { codeNAF?: string } | null)?.codeNAF ?? null,
        candidats,
        statut: "en_attente",
        resolvedSiret: null,
        signalId: pendingId,
        createdAt: nowIso,
      })
      .onConflictDoNothing();
  };

  /**
   * Tranche France Travail → établissement sans tranche INSEE. Une tranche déjà
   * connue (INSEE ou propagée) n'est jamais remplacée.
   */
  const tranchesVues = new Set<string>();
  const propagerTranche = async (o: (typeof schema.offreBrute.$inferSelect)) => {
    if (!o.siret || !estTrancheConnue(o.trancheEffectifEtab) || tranchesVues.has(o.siret)) return;
    tranchesVues.add(o.siret);
    const etab = (
      await db
        .select({ trancheEffectif: schema.etablissement.trancheEffectif })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siret, o.siret))
    )[0];
    if (!etab || estTrancheConnue(etab.trancheEffectif)) return;
    await db
      .update(schema.etablissement)
      .set({
        trancheEffectif: o.trancheEffectifEtab,
        trancheEffectifSource: "francetravail",
        effectifEstime: effectifEstime(o.trancheEffectifEtab),
      })
      .where(eq(schema.etablissement.siret, o.siret));
    stats.tranchesPropagees++;
  };

  if (aTraiter.length > 0) {
    const rapprocheur = await creerRapprocheur(db);

    for (const o of aTraiter) {
      const nafOffre = (o.payload as { codeNAF?: string } | null)?.codeNAF ?? null;
      const divOffre = division(nafOffre);
      // Hors cible ICP : on ne consomme pas d'appel réseau pour ce prospect —
      // le référentiel local reste consulté (gratuit).
      const horsCible = divisionsCibles.size > 0 && (!divOffre || !divisionsCibles.has(divOffre));

      const r = await rapprocheur.rapprocher(
        {
          denomination: o.entrepriseNom!,
          codePostal: o.codePostal,
          departement: o.codePostal?.slice(0, 2) ?? null,
          naf: nafOffre,
        },
        { sansReseau: horsCible },
      );

      if (r.decision === "auto") {
        await rattacher(o, r.siret);
        stats.autos++;
        if (r.viaSirene) stats.autosViaSirene++;
        await propagerTranche(o);
        continue;
      }
      if (horsCible) {
        stats.horsCible++;
        continue;
      }
      if (r.decision === "ambigu") {
        await mettreEnFile(
          o,
          r.candidats.map((c) => ({
            siret: c.siret,
            denomination: c.denomination,
            commune: c.commune,
            naf: c.naf,
            similarite: c.similarite,
          })),
        );
        stats.ambigus++;
      } else {
        stats.rejets++;
      }
    }
  }

  // Les offres déjà rattachées (import précédent) peuvent aussi apporter une tranche.
  for (const o of rattachees) await propagerTranche(o);

  return stats;
}


/** Charge les offres réelles (hors fixtures), rapproche, dérive, insère (idempotent). */
export async function deriveEtEnregistrer(
  db: PostgresJsDatabase<typeof schema>,
  now: Date = new Date(),
): Promise<{ derives: number; inseres: number; sansSiret: number; rapprochement: RapprochementStats }> {
  const offres = await db
    .select()
    .from(schema.offreBrute)
    .where(notLike(schema.offreBrute.source, "fixture:%"));

  const rapprochement = await rapprocherOffresSansSiret(db, offres, now);

  const signaux = deriveSignaux(
    offres.map((o) => ({
      id: o.id,
      siret: o.siret,
      entrepriseNom: o.entrepriseNom,
      intitule: o.intitule,
      typeContrat: o.typeContrat,
      dureeContratJours: o.dureeContratJours,
      rome: o.rome,
      romeLibelle: romeLibelleDe(o),
      codePostal: o.codePostal,
      commune: o.commune,
      codeInsee: o.codeInsee,
      lat: o.lat,
      lon: o.lon,
      parAgenceInterim: o.parAgenceInterim,
      datePublication: o.datePublication,
      dateActualisation: o.dateActualisation,
      nbActualisations: o.nbActualisations,
      nombrePostes: o.nombrePostes,
      manqueCandidats: o.manqueCandidats,
      trancheEffectifEtab: o.trancheEffectifEtab,
      closedAt: o.closedAt,
      payload: o.payload,
    })),
    now,
  );

  const nowIso = now.toISOString();
  // Insertion par lots : `returning` compte ce qui a réellement été écrit,
  // ON CONFLICT DO NOTHING ne renvoyant rien pour les doublons.
  let inseres = 0;
  const aInserer = signaux.map((s) => ({ id: crypto.randomUUID(), ingestedAt: nowIso, ...s }));
  for (const paquet of chunk(aInserer)) {
    const ecrits = await db
      .insert(schema.signal)
      .values(paquet)
      .onConflictDoNothing()
      .returning({ id: schema.signal.id });
    inseres += ecrits.length;
  }

  const sansSiret = offres.filter((o) => o.parAgenceInterim !== 1 && !o.siret).length;
  return { derives: signaux.length, inseres, sansSiret, rapprochement };
}
