/**
 * Ingestion BOAMP : avis d'attribution (MARCHE_ATTRIBUE, le jour de la parution)
 * et appels d'offres ouverts sur le bassin (AO_OUVERT, signal de Tempo).
 *
 * Le BOAMP ne publie ni SIRET ni montant : chaque titulaire est rapproché par
 * raison sociale (référentiel local, puis SIRENE), les ambigus vont en file de
 * résolution. Le montant arrivera du DECP quelques semaines plus tard.
 *
 * Sans argument, le département est celui de l'agence inscrite.
 * Usage : npm run ingest:boamp -- --depuis=90d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { boampAdapter } from "../../src/lib/ingest/adapters/boamp";
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
    `[boamp] ${decrireZone(zone)} : avis publiés pour le département ${departement}, ` +
      `${depuisJours} derniers jours`,
  );

  const stats = await runIngestion(db, boampAdapter, { depuisJours, departement });
  const r = stats.rapprochement;
  console.log(
    `[boamp] terminé : ${stats.recordsIn} avis lus, ${stats.recordsOut} signaux écrits, ${stats.erreurs.length} erreurs`,
  );
  console.log(
    `[boamp] rapprochement des titulaires : ${r.autos} automatiques (dont ${r.autosViaSirene} via SIRENE), ` +
      `${r.ambigus} en file de résolution, ${r.rejets} rejets`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  console.log("[boamp] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
