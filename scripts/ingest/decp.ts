/**
 * Ingestion DECP : marchés publics attribués (signaux MARCHE_ATTRIBUE).
 *
 * Sans argument, le département est celui de l'agence inscrite.
 * Usage : npm run ingest:decp -- --depuis=90d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { decpAdapter } from "../../src/lib/ingest/adapters/decp";
import { enrichirSiretsManquants, siretsOrphelins } from "../../src/lib/ingest/enrich";
import { chargerZone, decrireZone } from "../zone";

const { values } = parseArgs({
  options: {
    depuis: { type: "string" },
    departement: { type: "string" },
  },
});

const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 90;

async function main() {
  const db = getDb();
  const zone = await chargerZone();
  const departement = values.departement ?? zone.departement;
  if (!departement) {
    throw new Error(
      "Département inconnu — renseignez-le sur la zone de l'agence (/zone) ou passez --departement.",
    );
  }

  console.log(
    `[decp] ${decrireZone(zone)} : marchés exécutés dans le département ${departement}, ` +
      `${depuisJours} derniers jours`,
  );

  const stats = await runIngestion(db, decpAdapter, { depuisJours, departement });
  console.log(
    `[decp] terminé : ${stats.recordsIn} marchés lus, ${stats.recordsOut} signaux, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);

  // Un marché exécuté dans le département peut être remporté par une entreprise
  // dont le siège est ailleurs : sans ce rattrapage, le signal ne score personne.
  const orphelins = await siretsOrphelins(db, "MARCHE_ATTRIBUE");
  if (orphelins.length > 0) {
    console.log(`[decp] enrichissement de ${orphelins.length} titulaires absents du référentiel…`);
    const enrich = await enrichirSiretsManquants(db, orphelins);
    console.log(
      `[decp] enrichissement : ${enrich.ajoutes} établissements ajoutés, ${enrich.introuvables} introuvables chez SIRENE`,
    );
  }

  console.log("[decp] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
