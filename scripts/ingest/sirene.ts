/**
 * Ingestion SIRENE : référentiel des établissements du bassin.
 *
 * Sans argument, la zone et les secteurs cibles sont ceux de l'agence inscrite
 * dans l'application. Les options ne servent qu'à s'en écarter ponctuellement :
 *   npm run ingest:sirene -- --lat=46.5591 --lon=3.3255 --rayon=30 --naf=41,42,43
 * --naf accepte des divisions (2 chiffres) ou des codes complets (43.99C),
 * les divisions sont développées via data/reference/naf-codes.json.
 */
import "../env";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { sireneAdapter } from "../../src/lib/ingest/adapters/sirene";
import { chargerZone, decrireZone } from "../zone";

const { values } = parseArgs({
  options: {
    lat: { type: "string" },
    lon: { type: "string" },
    rayon: { type: "string" },
    naf: { type: "string" },
  },
});

/** Développe divisions et codes NAF en codes complets, tels que les attend SIRENE. */
function expandNafs(demandes: string[]): string[] | undefined {
  if (demandes.length === 0) return undefined;
  const tous: string[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "reference", "naf-codes.json"), "utf8"),
  );
  const codes = new Set<string>();
  for (const d of demandes) {
    if (/^\d{2}$/.test(d)) {
      for (const c of tous) if (c.startsWith(d + ".")) codes.add(c);
    } else {
      codes.add(d);
    }
  }
  return [...codes];
}

async function main() {
  const zone = await chargerZone();

  const lat = values.lat ? Number(values.lat) : zone.lat;
  const lon = values.lon ? Number(values.lon) : zone.lon;
  const rayonKm = values.rayon ? Number(values.rayon) : zone.rayonKm;
  const demandes = values.naf
    ? values.naf.split(",").map((s) => s.trim()).filter(Boolean)
    : zone.nafCibles;
  const nafs = expandNafs(demandes);

  console.log(
    `[sirene] ${decrireZone(zone)} : (${lat}, ${lon}), rayon ${rayonKm} km` +
      (nafs
        ? `, ${demandes.length} secteurs cibles → ${nafs.length} codes NAF`
        : ", tous NAF (déconseillé)"),
  );

  const stats = await runIngestion(getDb(), sireneAdapter, { lat, lon, rayonKm, nafs });
  console.log(
    `[sirene] terminé : ${stats.recordsIn} entreprises lues, ${stats.recordsOut} écritures, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  console.log("[sirene] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
