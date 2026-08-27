/**
 * Ingestion France Travail : offres brutes puis dérivation des signaux.
 * Usage : npm run ingest:offres -- --depuis=14d
 *
 * ATTENTION : l'endpoint France Travail n'est PAS vérifié (clé OAuth2 requise,
 * voir docs/sources.md et .env.example). L'appel échoue avec un message
 * explicite. La dérivation, elle, fonctionne sur toute offre déjà en staging.
 */
import "../env";
import { parseArgs } from "node:util";
import { getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { francetravailAdapter } from "../../src/lib/ingest/adapters/francetravail";
import { deriveEtEnregistrer } from "../../src/lib/ingest/derive-offres";

const { values } = parseArgs({
  options: { depuis: { type: "string" } },
});
const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 14;

const db = getDb();

async function main() {
  console.log(`[francetravail] ingestion des offres des ${depuisJours} derniers jours`);
  try {
    const stats = await runIngestion(db, francetravailAdapter, { depuisJours });
    console.log(`[francetravail] ${stats.recordsIn} offres lues, ${stats.recordsOut} nouvelles`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }

  const d = await deriveEtEnregistrer(db);
  const r = d.rapprochement;
  console.log(
    `[francetravail] rapprochement : ${r.autos} automatiques (dont ${r.autosViaSirene} via SIRENE), ` +
      `${r.ambigus} en file de résolution, ${r.rejets} rejets, ${r.horsCible} hors secteurs cibles`,
  );
  console.log(
    `[francetravail] dérivation : ${d.derives} signaux calculés, ${d.inseres} nouveaux insérés` +
      (d.sansSiret > 0 ? `, ${d.sansSiret} offres restent sans SIRET` : ""),
  );
  console.log("[francetravail] lancez `npm run score` pour recalculer les leads");
}

main();
