/**
 * Ingestion DECP : marchés publics attribués (signaux MARCHE_ATTRIBUE).
 * Usage : npm run ingest:decp -- --depuis=90d --departement=13
 */
import { parseArgs } from "node:util";
import { getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { decpAdapter } from "../../src/lib/ingest/adapters/decp";

const { values } = parseArgs({
  options: {
    depuis: { type: "string" },
    departement: { type: "string" },
  },
});

const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 90;
const departement = values.departement ?? "13";

console.log(`[decp] ingestion marchés attribués, exécution département ${departement}, ${depuisJours} derniers jours`);

const db = getDb();
runIngestion(db, decpAdapter, { depuisJours, departement })
  .then((stats) => {
    console.log(
      `[decp] terminé : ${stats.recordsIn} marchés lus, ${stats.recordsOut} signaux, ${stats.erreurs.length} erreurs`,
    );
    for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
    console.log("[decp] lancez `npm run score` pour recalculer les leads");
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
