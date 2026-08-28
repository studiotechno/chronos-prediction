/**
 * Ingestion Géorisques : installations classées (ICPE) autour de l'agence.
 * Pose l'attribut « site industriel classé » sur les établissements du
 * référentiel (lu par le Strate). Aucun signal, aucune donnée personnelle.
 *
 * Sans argument, la position et le rayon sont ceux de l'agence inscrite.
 * Usage : npm run ingest:georisques -- --lat=46.566 --lon=3.333 --rayon=30
 */
import "../env";
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { georisquesAdapter } from "../../src/lib/ingest/adapters/georisques";
import { chargerZone, decrireZone } from "../zone";

const { values } = parseArgs({
  options: {
    lat: { type: "string" },
    lon: { type: "string" },
    rayon: { type: "string" },
  },
});

async function main() {
  const zone = await chargerZone();
  const lat = values.lat ? Number(values.lat) : zone.lat;
  const lon = values.lon ? Number(values.lon) : zone.lon;
  const rayonKm = values.rayon ? Number(values.rayon) : zone.rayonKm;

  console.log(`[georisques] ${decrireZone(zone)} : (${lat}, ${lon}), rayon ${rayonKm} km`);

  const stats = await runIngestion(getDb(), georisquesAdapter, { lat, lon, rayonKm });
  console.log(
    `[georisques] terminé : ${stats.recordsIn} installations lues, ` +
      `${stats.recordsOut} établissements du référentiel marqués ICPE, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  console.log("[georisques] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
