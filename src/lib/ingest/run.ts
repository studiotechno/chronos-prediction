/**
 * Exécuteur d'ingestion : itère un adapter, valide/normalise, écrit en base
 * de façon idempotente (unicité signal(source, raw_ref)), journalise dans
 * ingestion_run. La dérivée EFFECTIF_UP est calculée ici, au ré-import SIRENE,
 * quand la tranche stockée diffère de la nouvelle.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import crypto from "node:crypto";
import * as schema from "../db/schema";
import { trancheRank } from "../reference/tranches";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "./types";
import type { IngestionError } from "../db/schema";

export type RunStats = {
  recordsIn: number;
  recordsOut: number;
  erreurs: IngestionError[];
};

export async function runIngestion<TRaw>(
  db: BetterSQLite3Database<typeof schema>,
  adapter: SourceAdapter<TRaw>,
  params: FetchParams,
): Promise<RunStats> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  db.insert(schema.ingestionRun)
    .values({ id: runId, source: adapter.id, startedAt, recordsIn: 0, recordsOut: 0, errors: [] })
    .run();

  const stats: RunStats = { recordsIn: 0, recordsOut: 0, erreurs: [] };

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
          if (appliquer(db, record)) stats.recordsOut++;
        } catch (e) {
          stats.erreurs.push({ message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } finally {
    db.update(schema.ingestionRun)
      .set({
        finishedAt: new Date().toISOString(),
        recordsIn: stats.recordsIn,
        recordsOut: stats.recordsOut,
        errors: stats.erreurs.slice(0, 100),
      })
      .where(eq(schema.ingestionRun.id, runId))
      .run();
  }

  return stats;
}

/** Applique un enregistrement normalisé. Renvoie true si quelque chose a été écrit. */
function appliquer(db: BetterSQLite3Database<typeof schema>, record: NormalizedRecord): boolean {
  if (record.kind === "etablissement") {
    const { entreprise, etablissement } = record;

    db.insert(schema.entreprise)
      .values(entreprise)
      .onConflictDoUpdate({
        target: schema.entreprise.siren,
        set: {
          denomination: entreprise.denomination,
          categorie: entreprise.categorie,
          etat: entreprise.etat,
        },
      })
      .run();

    const existant = db
      .select()
      .from(schema.etablissement)
      .where(eq(schema.etablissement.siret, etablissement.siret))
      .all()[0];

    // Dérivée EFFECTIF_UP : passage à une tranche supérieure entre deux imports
    if (
      existant?.trancheEffectif &&
      etablissement.trancheEffectif &&
      trancheRank(etablissement.trancheEffectif) > trancheRank(existant.trancheEffectif)
    ) {
      db.insert(schema.signal)
        .values({
          id: crypto.randomUUID(),
          siret: etablissement.siret,
          siren: etablissement.siren,
          type: "EFFECTIF_UP",
          source: "sirene",
          occurredAt: new Date().toISOString(),
          ingestedAt: new Date().toISOString(),
          confidence: 1,
          payload: {
            trancheAvant: existant.trancheEffectif,
            trancheApres: etablissement.trancheEffectif,
          },
          rawRef: `effectif-${etablissement.siret}-${etablissement.trancheEffectif}`,
        })
        .onConflictDoNothing()
        .run();
    }

    db.insert(schema.etablissement)
      .values(etablissement)
      .onConflictDoUpdate({ target: schema.etablissement.siret, set: { ...etablissement } })
      .run();
    return true;
  }

  if (record.kind === "signal") {
    const signal = { ...record.signal };
    // Rattachement SIREN → siège : un signal BODACC ne porte qu'un SIREN.
    // On l'accroche au siège si l'entreprise est dans le référentiel du bassin,
    // sinon il reste sans SIRET et ne score personne (hors bassin : normal).
    if (!signal.siret && signal.siren) {
      const etabs = db
        .select({ siret: schema.etablissement.siret, estSiege: schema.etablissement.estSiege })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siren, signal.siren))
        .all();
      signal.siret = etabs.find((e) => e.estSiege === 1)?.siret ?? etabs[0]?.siret ?? null;
    }
    const r = db
      .insert(schema.signal)
      .values({
        id: crypto.randomUUID(),
        ingestedAt: new Date().toISOString(),
        ...signal,
      })
      .onConflictDoNothing()
      .run();
    return r.changes > 0;
  }

  if (record.kind === "offre") {
    const now = new Date().toISOString();
    const existante = db
      .select({ id: schema.offreBrute.id })
      .from(schema.offreBrute)
      .where(eq(schema.offreBrute.id, record.offre.id))
      .all()[0];
    if (existante) {
      db.update(schema.offreBrute)
        .set({ lastSeenAt: now, closedAt: null })
        .where(eq(schema.offreBrute.id, record.offre.id))
        .run();
      return false;
    }
    db.insert(schema.offreBrute)
      .values({ ...record.offre, firstSeenAt: now, lastSeenAt: now, closedAt: null })
      .run();
    return true;
  }

  return false;
}
