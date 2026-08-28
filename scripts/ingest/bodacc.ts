/**
 * Ingestion BODACC : procédures collectives et mouvements de capital.
 *
 * Les annonces portent un SIREN, sur tout le département, alors que le référentiel
 * est bâti autour de l'agence et filtré par NAF : mesuré sur l'Allier, 4 signaux sur
 * 446 trouvaient leur établissement. Après l'ingestion, ce script va donc chercher
 * chez SIRENE le siège des entreprises qui augmentent leur capital (signal positif,
 * qui peut faire un lead), puis rattache tous les signaux orphelins dont le SIREN est
 * désormais connu — procédures collectives comprises, pour que le malus s'applique.
 *
 * Sans argument, le département est celui de l'agence inscrite.
 * Usage : npm run ingest:bodacc -- --depuis=90d --departement=03
 */
import "../env";
import { parseArgs } from "node:util";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { closeDb, getDb, schema } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { bodaccAdapter } from "../../src/lib/ingest/adapters/bodacc";
import { enrichirSirensManquants } from "../../src/lib/ingest/enrich";
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
    `[bodacc] ${decrireZone(zone)} : département ${departement}, ${depuisJours} derniers jours`,
  );

  const stats = await runIngestion(db, bodaccAdapter, { depuisJours, departement });
  console.log(
    `[bodacc] terminé : ${stats.recordsIn} annonces lues, ${stats.recordsOut} signaux, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);

  // --- Enrichissement : le siège des entreprises qui bougent leur capital
  const orphelins = await db
    .select({ id: schema.signal.id, siren: schema.signal.siren, type: schema.signal.type })
    .from(schema.signal)
    .where(and(eq(schema.signal.source, "bodacc"), isNull(schema.signal.siret), isNotNull(schema.signal.siren)));
  const avant = orphelins.length;
  const sirensCapital = [
    ...new Set(orphelins.filter((s) => s.type === "BODACC_CAPITAL").map((s) => s.siren!)),
  ];
  if (sirensCapital.length > 0) {
    console.log(`[bodacc] enrichissement de ${sirensCapital.length} entreprises (capital) absentes du référentiel…`);
    const enrich = await enrichirSirensManquants(db, sirensCapital);
    console.log(
      `[bodacc] enrichissement : ${enrich.ajoutes} sièges ajoutés, ${enrich.introuvables} introuvables chez SIRENE`,
    );
  }

  // --- Rattachement de tous les signaux orphelins dont le SIREN est désormais connu
  const sirens = [...new Set(orphelins.map((s) => s.siren!))];
  let rattaches = 0;
  if (sirens.length > 0) {
    const etabs = await db
      .select({ siret: schema.etablissement.siret, siren: schema.etablissement.siren, estSiege: schema.etablissement.estSiege })
      .from(schema.etablissement)
      .where(inArray(schema.etablissement.siren, sirens));
    const siegeParSiren = new Map<string, string>();
    for (const e of etabs) {
      if (e.estSiege === 1 || !siegeParSiren.has(e.siren)) siegeParSiren.set(e.siren, e.siret);
    }
    for (const s of orphelins) {
      const siret = siegeParSiren.get(s.siren!);
      if (!siret) continue;
      await db.update(schema.signal).set({ siret }).where(eq(schema.signal.id, s.id));
      rattaches++;
    }
  }
  console.log(
    `[bodacc] rattachement : ${avant} signaux sans établissement avant, ${rattaches} rattachés, ${avant - rattaches} restent hors référentiel`,
  );
  console.log("[bodacc] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
