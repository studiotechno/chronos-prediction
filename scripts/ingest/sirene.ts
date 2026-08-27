/**
 * Ingestion SIRENE : référentiel des établissements du bassin.
 * Usage : npm run ingest:sirene -- --lat=43.3026 --lon=5.3691 --rayon=30 --naf=41,42,43,49,52
 * --naf accepte des divisions (2 chiffres) ou des codes complets (43.99C),
 * les divisions sont développées via data/reference/naf-codes.json.
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { sireneAdapter } from "../../src/lib/ingest/adapters/sirene";
import { AGENCE_DEMO } from "../../src/lib/fixtures/agence";

const { values } = parseArgs({
  options: {
    lat: { type: "string" },
    lon: { type: "string" },
    rayon: { type: "string" },
    naf: { type: "string" },
  },
});

function expandNafs(arg: string | undefined): string[] | undefined {
  if (!arg) return undefined;
  const tous: string[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "reference", "naf-codes.json"), "utf8"),
  );
  const demandes = arg.split(",").map((s) => s.trim()).filter(Boolean);
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

const lat = values.lat ? Number(values.lat) : AGENCE_DEMO.lat;
const lon = values.lon ? Number(values.lon) : AGENCE_DEMO.lon;
const rayonKm = values.rayon ? Number(values.rayon) : AGENCE_DEMO.rayonKm;
const nafs = expandNafs(values.naf);

console.log(
  `[sirene] ingestion autour de (${lat}, ${lon}), rayon ${rayonKm} km` +
    (nafs ? `, ${nafs.length} codes NAF` : ", tous NAF (déconseillé)"),
);

const db = getDb();
runIngestion(db, sireneAdapter, { lat, lon, rayonKm, nafs })
  .then((stats) => {
    console.log(
      `[sirene] terminé : ${stats.recordsIn} entreprises lues, ${stats.recordsOut} écritures, ${stats.erreurs.length} erreurs`,
    );
    for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
    console.log("[sirene] lancez `npm run score` pour recalculer les leads");
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
