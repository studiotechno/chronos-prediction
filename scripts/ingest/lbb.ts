/**
 * Ingestion La Bonne Boîte v2 : potentiel d'embauche (0-5) posé en attribut sur
 * les établissements du référentiel, par métier ROME cible de l'agence.
 *
 * L'endpoint n'a pas pu être vérifié par appel réel (403 sur tous les chemins
 * essayés le 28/08/2026, voir src/lib/ingest/adapters/labonneboite.ts) :
 * ce script dit clairement le HTTP reçu et, en cas de 403, ce qu'il faut faire.
 * Il n'est pas dans `ingest:all` tant que l'endpoint n'est pas confirmé.
 *
 * Usage : npm run ingest:lbb            (zone et ROME de l'agence inscrite)
 *         LBB_ENDPOINT=https://… npm run ingest:lbb
 */
import "../env";
import { closeDb, getDb, schema } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import {
  ENDPOINT_DEFAUT,
  labonneboiteAdapter,
  obtenirJetonLbb,
} from "../../src/lib/ingest/adapters/labonneboite";
import { chargerZone, decrireZone } from "../zone";

const CHEMINS_A_SONDER = [
  "/partenaire/labonneboite/v2/recherche",
  "/partenaire/labonneboite/v2/entreprises",
  "/partenaire/labonneboite/v2/company/",
  "/partenaire/labonneboite/v1/company/",
];

async function sonder(lat: number, lon: number, rayonKm: number, rome: string) {
  console.log("[labonneboite] sondage des chemins connus avec le jeton v2 :");
  let jeton: string;
  try {
    jeton = await obtenirJetonLbb();
  } catch (e) {
    console.log("  jeton :", e instanceof Error ? e.message : e);
    return;
  }
  for (const chemin of CHEMINS_A_SONDER) {
    const url =
      `https://api.francetravail.io${chemin}?rome=${rome}&rome_codes=${rome}` +
      `&latitude=${lat}&longitude=${lon}&distance=${Math.round(rayonKm)}`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" } });
      const corps = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
      console.log(`  ${chemin} → HTTP ${res.status}${corps ? ` ${corps}` : ""}`);
    } catch (e) {
      console.log(`  ${chemin} → ${e instanceof Error ? e.message : e}`);
    }
  }
}

async function main() {
  const db = getDb();
  const zone = await chargerZone();
  const agence = (await db.select().from(schema.agence).limit(1))[0];
  const romes = agence?.romeCibles ?? [];
  const endpoint = process.env.LBB_ENDPOINT ?? ENDPOINT_DEFAUT;

  console.log(
    `[labonneboite] ${decrireZone(zone)} : (${zone.lat}, ${zone.lon}), rayon ${zone.rayonKm} km, ` +
      `${romes.length} métiers ROME cibles — endpoint ${endpoint}`,
  );

  try {
    const stats = await runIngestion(db, labonneboiteAdapter, {
      lat: zone.lat,
      lon: zone.lon,
      rayonKm: zone.rayonKm,
      romes,
    });
    console.log(
      `[labonneboite] terminé : ${stats.recordsIn} établissements lus, ` +
        `${stats.recordsOut} du référentiel annotés, ${stats.erreurs.length} erreurs`,
    );
    for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
    if (stats.recordsIn > 0) console.log("[labonneboite] lancez `npm run score` pour recalculer les leads");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[labonneboite] échec : ${message}`);
    if (/HTTP 403/.test(message)) {
      console.error(
        "[labonneboite] 403 : le jeton est accepté mais l'API refuse le scope. Sur https://francetravail.io, " +
          "ouvrez votre application, souscrivez à « La Bonne Boîte v2 » et attendez l'autorisation manuelle " +
          "de France Travail (accès conditionné). Si l'accès est déjà actif, l'endpoint documenté diffère de " +
          "celui-ci : passez-le via LBB_ENDPOINT (et LBB_PARAM_* pour les noms de paramètres).",
      );
    }
  }

  await sonder(zone.lat, zone.lon, zone.rayonKm, romes[0] ?? "F1703");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
