/**
 * Ingestion BODACC : procédures collectives et mouvements de capital.
 * Usage : npm run ingest:bodacc -- --depuis=90d --departement=13
 */
import { parseArgs } from "node:util";
import { getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { bodaccAdapter } from "../../src/lib/ingest/adapters/bodacc";

const { values } = parseArgs({
  options: {
    depuis: { type: "string" },
    departement: { type: "string" },
  },
});

const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 90;
const departement = values.departement ?? "13";

console.log(`[bodacc] ingestion département ${departement}, ${depuisJours} derniers jours`);

const db = getDb();
runIngestion(db, bodaccAdapter, { depuisJours, departement })
  .then((stats) => {
    console.log(
      `[bodacc] terminé : ${stats.recordsIn} annonces lues, ${stats.recordsOut} signaux, ${stats.erreurs.length} erreurs`,
    );
    for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
    console.log("[bodacc] lancez `npm run score` pour recalculer les leads");
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
