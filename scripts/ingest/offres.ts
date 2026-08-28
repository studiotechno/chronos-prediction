/**
 * Ingestion France Travail : offres brutes puis dérivation des signaux.
 *
 * Sans argument, le département est celui de l'agence inscrite — l'API Offres
 * filtre par département, et le rapprochement des offres sans SIRET s'appuie
 * ensuite sur les secteurs cibles de cette même agence.
 * Usage : npm run ingest:offres -- --depuis=14d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { francetravailAdapter } from "../../src/lib/ingest/adapters/francetravail";
import { deriveEtEnregistrer } from "../../src/lib/ingest/derive-offres";
import { chargerZone, decrireZone } from "../zone";

const { values } = parseArgs({
  options: {
    depuis: { type: "string" },
    departement: { type: "string" },
  },
});
const depuisJours = values.depuis ? Number(values.depuis.replace(/d$/i, "")) : 14;

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
    `[francetravail] ${decrireZone(zone)} : département ${departement}, ` +
      `offres des ${depuisJours} derniers jours`,
  );
  try {
    const stats = await runIngestion(db, francetravailAdapter, { depuisJours, departement });
    console.log(`[francetravail] ${stats.recordsIn} offres lues, ${stats.recordsOut} nouvelles`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }

  const d = await deriveEtEnregistrer(db);
  const r = d.rapprochement;
  console.log(
    `[francetravail] rapprochement : ${r.autos} automatiques (dont ${r.autosViaSirene} via SIRENE), ` +
      `${r.ambigus} en file de résolution, ${r.rejets} rejets, ${r.horsCible} hors secteurs cibles, ` +
      `${r.tranchesPropagees} tranches d'effectif propagées au référentiel`,
  );
  console.log(
    `[francetravail] dérivation : ${d.derives} signaux calculés, ${d.inseres} nouveaux insérés` +
      (d.sansSiret > 0 ? `, ${d.sansSiret} offres restent sans SIRET` : ""),
  );
  console.log("[francetravail] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
