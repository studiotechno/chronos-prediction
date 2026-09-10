/**
 * Ingestion France Travail : offres brutes, clôture des disparues, puis
 * rapprochement et dérivation des signaux.
 *
 * La lecture couvre toute la profondeur utile (90 jours par défaut, par
 * fenêtres de 30 jours) : c'est ce qui permet de voir une offre DISPARAÎTRE et
 * de la clôturer — sans quoi ni la republication ni la conjoncture n'existent.
 * La clôture n'a lieu qu'après une lecture complète.
 *
 * Sans argument, le département est celui de l'agence inscrite.
 * Usage : npm run ingest:offres -- --depuis=90d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { francetravailAdapter } from "../../src/lib/ingest/adapters/francetravail";
import { deriveEtEnregistrer } from "../../src/lib/ingest/derive-offres";
import { cloturerOffresDisparues } from "../../src/lib/ingest/cloture";
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
    `[francetravail] ${decrireZone(zone)} : département ${departement}, ` +
      `offres des ${depuisJours} derniers jours`,
  );
  const debutRun = new Date();
  let lectureComplete = false;
  try {
    const stats = await runIngestion(db, francetravailAdapter, { depuisJours, departement });
    lectureComplete = stats.erreurs.length === 0;
    console.log(`[francetravail] ${stats.recordsIn} offres lues, ${stats.recordsOut} nouvelles, ${stats.erreurs.length} erreurs`);
    for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
  }

  if (lectureComplete) {
    const closes = await cloturerOffresDisparues(db, {
      source: "francetravail",
      depuis: new Date(debutRun.getTime() - depuisJours * 86400000),
      vuAvant: debutRun.toISOString(),
    });
    console.log(`[francetravail] clôture : ${closes} offres disparues de la source`);
  } else {
    console.log("[francetravail] lecture incomplète : aucune clôture aujourd'hui");
  }

  const d = await deriveEtEnregistrer(db);
  const r = d.rapprochement;
  console.log(
    `[francetravail] rapprochement : ${r.autos} automatiques (dont ${r.autosViaSirene} via SIRENE), ` +
      `${r.ambigus} en file de résolution, ${r.rejets} rejets, ${r.horsCible} hors secteurs cibles, ` +
      `${r.tranchesPropagees} tranches d'effectif propagées, ${r.agencesDetectees} annonceurs reclassés en agences`,
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
