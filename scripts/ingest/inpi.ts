/**
 * Ingestion des ratios INPI / BCE : plusieurs exercices de comptes par entreprise.
 *
 * Interroge nommément les SIREN du référentiel qui comptent — établissements
 * actifs employeurs, et toute entreprise portant un signal — par lots de 40.
 * Met à jour le chiffre d'affaires et le résultat des deux derniers exercices,
 * et dérive CA_CROISSANCE / CA_BAISSE (variation ≥ 15 %).
 *
 * Usage : npm run ingest:inpi            (SIREN du référentiel)
 *         npm run ingest:inpi -- --tous  (toutes les entreprises connues)
 */
import "../env";
import { parseArgs } from "node:util";
import { and, eq, isNotNull } from "drizzle-orm";
import { closeDb, getDb, schema } from "../../src/lib/db";
import { runIngestion } from "../../src/lib/ingest/run";
import { inpiAdapter } from "../../src/lib/ingest/adapters/inpi";

const { values } = parseArgs({ options: { tous: { type: "boolean" } } });

async function main() {
  const db = getDb();
  let sirens: string[];
  if (values.tous) {
    sirens = (await db.select({ siren: schema.entreprise.siren }).from(schema.entreprise)).map((r) => r.siren);
  } else {
    const [employeurs, signales] = await Promise.all([
      db
        .select({ siren: schema.etablissement.siren })
        .from(schema.etablissement)
        .where(and(eq(schema.etablissement.etatAdministratif, "A"), eq(schema.etablissement.caractereEmployeur, "O"))),
      db.select({ siren: schema.signal.siren }).from(schema.signal).where(isNotNull(schema.signal.siren)),
    ]);
    sirens = [...new Set([...employeurs.map((r) => r.siren), ...signales.map((r) => r.siren!)])];
  }
  console.log(`[inpi] ${sirens.length} entreprises à interroger (${Math.ceil(sirens.length / 40)} requêtes)`);

  const stats = await runIngestion(db, inpiAdapter, { sirens });
  console.log(
    `[inpi] terminé : ${stats.recordsIn} entreprises avec des comptes, ${stats.recordsOut} mises à jour, ${stats.erreurs.length} erreurs`,
  );
  for (const e of stats.erreurs.slice(0, 5)) console.error("  !", e.message);
  console.log("[inpi] lancez `npm run score` pour recalculer les leads");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
