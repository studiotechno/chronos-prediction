/**
 * Seed : poids par défaut, agence, et (par défaut) fixtures de démonstration.
 * Idempotent : ré-exécutable sans dupliquer (upserts + unicité signal(source, raw_ref)).
 *
 * `--sans-fixtures` prépare une base destinée aux données RÉELLES : poids et agence
 * seulement, aucune donnée fictive. C'est le point de départ d'un déploiement
 * (npm run db:seed -- --sans-fixtures puis npm run ingest:all).
 */
import { parseArgs } from "node:util";
import { getDb, schema } from "../src/lib/db";
import { WEIGHT_DEFAULTS } from "../src/lib/scoring/weights-defaults";
import { AGENCE_DEMO } from "../src/lib/fixtures/agence";
import { seedFixtures } from "../src/lib/fixtures/seed-fixtures";

const { values } = parseArgs({ options: { "sans-fixtures": { type: "boolean" } } });
const avecFixtures = !values["sans-fixtures"];

const db = getDb();
const now = new Date().toISOString();

// --- Poids (n'écrase pas une valeur modifiée via /reglages, met à jour bornes et libellés)
for (const w of WEIGHT_DEFAULTS) {
  db.insert(schema.weights)
    .values({ ...w, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.weights.key,
      set: { min: w.min, max: w.max, labelFr: w.labelFr, descriptionFr: w.descriptionFr },
    })
    .run();
}
console.log(`[seed] ${WEIGHT_DEFAULTS.length} poids`);

// --- Agence de démo (mono-agence en V0 : on remplace toute agence précédente)
db.delete(schema.agence).run();
db.insert(schema.agence).values(AGENCE_DEMO).run();
console.log(`[seed] agence « ${AGENCE_DEMO.nom} »`);

// --- Fixtures (établissements, signaux, offres brutes, file de résolution)
if (avecFixtures) {
  const stats = seedFixtures(db);
  console.log(
    `[seed] fixtures : ${stats.entreprises} entreprises, ${stats.etablissements} établissements, ` +
      `${stats.signaux} signaux, ${stats.offres} offres brutes, ${stats.resolutions} résolutions en attente`,
  );
  console.log("[seed] terminé — lancez `npm run score` pour calculer les leads");
} else {
  console.log("[seed] sans fixtures : base prête pour des données réelles");
  console.log("[seed] terminé — lancez `npm run ingest:all` puis `npm run score`");
}
