/**
 * Pont base ↔ moteur : charge les entrées depuis SQLite, exécute le moteur pur,
 * et (optionnellement) persiste scores et leads. Utilisé par `npm run score`
 * et par l'API de recalcul en direct de /reglages.
 */
import { isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { tauxRecoursInterim } from "../reference/dares";
import { defaultWeightMap } from "./weights-defaults";
import { computeAll, type EngineInput, type EngineOutput } from "./engine";
import type { SignalScoringInput, WeightMap } from "./types";

export function loadWeights(db: BetterSQLite3Database<typeof schema>): WeightMap {
  const rows = db.select().from(schema.weights).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function loadEngineInput(
  db: BetterSQLite3Database<typeof schema>,
  weightsOverride?: Partial<WeightMap>,
): EngineInput {
  // Les défauts du code couvrent un poids introduit après le dernier seed
  const weights: WeightMap = { ...defaultWeightMap(), ...loadWeights(db) };
  if (weightsOverride) {
    for (const [k, v] of Object.entries(weightsOverride)) {
      if (typeof v === "number" && Number.isFinite(v)) weights[k] = v;
    }
  }

  const agenceRow = db.select().from(schema.agence).limit(1).all()[0];
  if (!agenceRow) {
    throw new Error("Aucune agence configurée — lancez `npm run db:seed`.");
  }

  const etabs = db.select().from(schema.etablissement).all();
  const parSiren = new Map<string, number>();
  for (const e of etabs) {
    if (e.etatAdministratif === "A") parSiren.set(e.siren, (parSiren.get(e.siren) ?? 0) + 1);
  }

  const signauxRows = db.select().from(schema.signal).where(isNotNull(schema.signal.siret)).all();
  const signauxParSiret = new Map<string, SignalScoringInput[]>();
  for (const s of signauxRows) {
    if (!s.siret) continue;
    const liste = signauxParSiret.get(s.siret) ?? [];
    liste.push({
      id: s.id,
      type: s.type,
      occurredAt: s.occurredAt,
      confidence: s.confidence,
      payload: s.payload ?? null,
    });
    signauxParSiret.set(s.siret, liste);
  }

  return {
    etablissements: etabs.map((e) => ({
      siret: e.siret,
      siren: e.siren,
      denomination: e.denomination,
      naf: e.naf,
      effectifEstime: e.effectifEstime,
      lat: e.lat,
      lon: e.lon,
      dateCreation: e.dateCreation,
      etatAdministratif: e.etatAdministratif,
      nbEtabsBassin: parSiren.get(e.siren) ?? 1,
    })),
    signauxParSiret,
    agence: {
      lat: agenceRow.lat,
      lon: agenceRow.lon,
      rayonKm: agenceRow.rayonKm,
      romeCibles: agenceRow.romeCibles ?? [],
    },
    weights,
    tauxRecours: tauxRecoursInterim,
    now: new Date(),
  };
}

export function runScoring(
  db: BetterSQLite3Database<typeof schema>,
  opts: { persist: boolean; weightsOverride?: Partial<WeightMap> } = { persist: true },
): EngineOutput {
  const input = loadEngineInput(db, opts.weightsOverride);
  const output = computeAll(input);

  if (opts.persist) {
    const computedAt = input.now.toISOString();
    // Statuts commerciaux existants à préserver au recalcul
    const statuts = new Map(db.select().from(schema.lead).all().map((l) => [l.siret, l.statut]));

    db.transaction((tx) => {
      tx.delete(schema.scoreStrate).run();
      tx.delete(schema.scoreSismo).run();
      tx.delete(schema.lead).run();
      for (const [siret, r] of output.strates) {
        tx.insert(schema.scoreStrate)
          .values({ siret, score: r.score, components: r.components, computedAt })
          .run();
      }
      for (const [siret, r] of output.sismos) {
        tx.insert(schema.scoreSismo)
          .values({ siret, score: r.score, components: r.components, computedAt })
          .run();
      }
      for (const lead of output.leads) {
        tx.insert(schema.lead)
          .values({
            siret: lead.siret,
            scoreFinal: lead.scoreFinal,
            strate: lead.strate,
            sismo: lead.sismo,
            statut: statuts.get(lead.siret) ?? "nouveau",
            segment: lead.segment,
            raisonFr: lead.raisonFr,
            topSignals: lead.topSignals,
            computedAt,
          })
          .run();
      }
    });
  }

  return output;
}
