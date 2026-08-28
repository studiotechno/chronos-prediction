/**
 * Ingestion ACCO : accords d'entreprise (DILA) → ACCORD_SURCHARGE / ACCORD_RESTRUCTURATION.
 *
 * ATTENTION VOLUME : chaque livraison hebdomadaire pèse ~400 Mo (archive tar.gz
 * nationale, ~1 500 accords). Elle est téléchargée une fois dans .cache/acco/ et
 * extraite sur place ; seuls les accords du département, ou dont le SIREN est
 * dans le référentiel, sont retenus. Prévoir de l'espace disque et une exécution
 * hebdomadaire, pas quotidienne.
 *
 * Sans argument : département de l'agence inscrite, livraisons des 28 derniers jours.
 * Usage : npm run ingest:acco -- --depuis=7d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb, schema } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { accoAdapter } from "../../src/lib/ingest/adapters/acco";
import { chargerZone, decrireZone } from "../zone";

const { values } = parseArgs({
  options: {
    depuis: { type: "string" },
    departement: { type: "string" },
  },
});

const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 28;

async function main() {
  const db = getDb();
  const zone = await chargerZone();
  const departement = values.departement ?? zone.departement;
  if (!departement) {
    throw new Error(
      "Département inconnu — renseignez-le sur la zone de l'agence (/zone) ou passez --departement.",
    );
  }

  const sirens = [
    ...new Set(
      (await db.select({ siren: schema.etablissement.siren }).from(schema.etablissement)).map((r) => r.siren),
    ),
  ];

  console.log(
    `[acco] ${decrireZone(zone)} : département ${departement}, ${sirens.length} SIREN du référentiel, ` +
      `livraisons des ${depuisJours} derniers jours`,
  );

  const debut = Date.now();
  const stats = await runIngestion(db, accoAdapter, { depuisJours, departement, sirets: sirens });
  console.log(
    `[acco] terminé en ${Math.round((Date.now() - debut) / 1000)} s : ${stats.recordsIn} accords de la zone lus, ` +
      `${stats.recordsOut} signaux écrits, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  console.log("[acco] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
