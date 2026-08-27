/**
 * Dérivation des signaux France Travail à partir du staging offre_brute.
 * Un signal n'est JAMAIS une offre recopiée : c'est une dérivée calculée
 * (republication, vélocité, CDD répétés, mission concurrente).
 *
 * Cœur pur et testable (deriveSignaux) + enveloppe base (deriveEtEnregistrer).
 * Limite documentée (cold start) : OFFRE_REPUBLIEE et OFFRE_VELOCITE ne
 * deviennent fiables qu'après plusieurs semaines d'ingestion régulière,
 * puisqu'une offre clôturée disparaît de l'API. Voir docs/sources.md.
 */
import { eq, notLike } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import crypto from "node:crypto";
import * as schema from "../db/schema";
import { matchEntity, type CandidatEtab } from "../matching/match";

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
  parAgenceInterim: number;
  datePublication: string;
  closedAt: string | null;
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
        intitule: o.intitule,
        rome: o.rome,
        commune: o.commune,
        codePostal: o.codePostal,
        agenceInterim: o.entrepriseNom,
      },
      rawRef: `mission-${o.id}`,
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

    // ------------------------------------------------------------ OFFRE_DIRECTE
    for (const o of liste) {
      if (ageJours(o.datePublication) > 90) continue;
      signaux.push({
        siret,
        siren,
        type: "OFFRE_DIRECTE",
        source: "francetravail",
        occurredAt: o.datePublication,
        confidence: 0.95,
        payload: { intitule: o.intitule, rome: o.rome, typeContrat: o.typeContrat },
        rawRef: `directe-${o.id}`,
      });
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
          intitule: derniere.intitule,
          rome: derniere.rome,
          nbRepublications: republications + 1,
          premierePublication: triees[0].datePublication,
        },
        rawRef: `repub-${siret}-${cleIntitule}-${triees.length}`,
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
      });
    }

    // ------------------------------------------------------------ OFFRE_VELOCITE
    // Volume sur 14 jours glissants > baseline 90 jours + 2 écarts-types.
    const n14 = liste.filter((o) => ageJours(o.datePublication) <= 14).length;
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

/**
 * Rapprochement des offres sans SIRET contre le référentiel du bassin :
 * ≥ 0.88 rattachement automatique (le SIRET est écrit sur l'offre),
 * 0.62-0.88 entrée en resolution_queue + signal en attente,
 * < 0.62 rejet compté.
 */
function rapprocherOffresSansSiret(
  db: BetterSQLite3Database<typeof schema>,
  offres: (typeof schema.offreBrute.$inferSelect)[],
  now: Date,
): { autos: number; ambigus: number; rejets: number } {
  const aTraiter = offres.filter((o) => o.parAgenceInterim !== 1 && !o.siret && o.entrepriseNom);
  if (aTraiter.length === 0) return { autos: 0, ambigus: 0, rejets: 0 };

  const referentiel: CandidatEtab[] = db
    .select({
      siret: schema.etablissement.siret,
      denomination: schema.etablissement.denomination,
      codePostal: schema.etablissement.codePostal,
      commune: schema.etablissement.commune,
      naf: schema.etablissement.naf,
    })
    .from(schema.etablissement)
    .all();

  let autos = 0;
  let ambigus = 0;
  let rejets = 0;
  const nowIso = now.toISOString();

  for (const o of aTraiter) {
    const resultat = matchEntity(
      { denomination: o.entrepriseNom!, codePostal: o.codePostal },
      referentiel,
    );

    if (resultat.decision === "auto") {
      db.update(schema.offreBrute)
        .set({ siret: resultat.candidat.siret })
        .where(eq(schema.offreBrute.id, o.id))
        .run();
      o.siret = resultat.candidat.siret; // la dérivation qui suit en profite
      autos++;
    } else if (resultat.decision === "ambigu") {
      const pendingId = `match-sig-${o.id}`;
      db.insert(schema.signal)
        .values({
          id: pendingId,
          siret: null,
          siren: null,
          type: "OFFRE_DIRECTE",
          source: "francetravail",
          occurredAt: o.datePublication,
          ingestedAt: nowIso,
          confidence: resultat.candidats[0]?.similarite ?? 0.7,
          payload: { intitule: o.intitule, rome: o.rome, typeContrat: o.typeContrat, entrepriseNom: o.entrepriseNom },
          rawRef: `pending-directe-${o.id}`,
        })
        .onConflictDoNothing()
        .run();
      db.insert(schema.resolutionQueue)
        .values({
          id: `match-${o.id}`,
          source: "francetravail",
          rawDenomination: o.entrepriseNom!,
          rawCodePostal: o.codePostal,
          rawNaf: null,
          candidats: resultat.candidats.map((c) => ({
            siret: c.siret,
            denomination: c.denomination,
            commune: c.commune,
            naf: c.naf,
            similarite: c.similarite,
          })),
          statut: "en_attente",
          resolvedSiret: null,
          signalId: pendingId,
          createdAt: nowIso,
        })
        .onConflictDoNothing()
        .run();
      ambigus++;
    } else {
      rejets++;
    }
  }

  return { autos, ambigus, rejets };
}

/** Charge les offres réelles (hors fixtures), rapproche, dérive, insère (idempotent). */
export function deriveEtEnregistrer(
  db: BetterSQLite3Database<typeof schema>,
  now: Date = new Date(),
): { derives: number; inseres: number; sansSiret: number; rapprochement: { autos: number; ambigus: number; rejets: number } } {
  const offres = db
    .select()
    .from(schema.offreBrute)
    .where(notLike(schema.offreBrute.source, "fixture:%"))
    .all();

  const rapprochement = rapprocherOffresSansSiret(db, offres, now);

  const signaux = deriveSignaux(
    offres.map((o) => ({
      id: o.id,
      siret: o.siret,
      entrepriseNom: o.entrepriseNom,
      intitule: o.intitule,
      typeContrat: o.typeContrat,
      dureeContratJours: o.dureeContratJours,
      rome: o.rome,
      codePostal: o.codePostal,
      commune: o.commune,
      parAgenceInterim: o.parAgenceInterim,
      datePublication: o.datePublication,
      closedAt: o.closedAt,
    })),
    now,
  );

  let inseres = 0;
  const nowIso = now.toISOString();
  for (const s of signaux) {
    const r = db
      .insert(schema.signal)
      .values({ id: crypto.randomUUID(), ingestedAt: nowIso, ...s })
      .onConflictDoNothing()
      .run();
    if (r.changes > 0) inseres++;
  }

  const sansSiret = offres.filter((o) => o.parAgenceInterim !== 1 && !o.siret).length;
  return { derives: signaux.length, inseres, sansSiret, rapprochement };
}
