/**
 * Seed : poids par défaut, agence de démo, fixtures réalistes (bassin de Marseille).
 * Idempotent : ré-exécutable sans dupliquer (upserts + unicité signal(source, raw_ref)).
 */
import { getDb, schema } from "../src/lib/db";
import { WEIGHT_DEFAULTS } from "../src/lib/scoring/weights-defaults";
import { AGENCE_DEMO } from "../src/lib/fixtures/agence";
import { seedFixtures } from "../src/lib/fixtures/seed-fixtures";

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

// --- Agence de démo (mono-agence en V0)
db.insert(schema.agence)
  .values(AGENCE_DEMO)
  .onConflictDoUpdate({ target: schema.agence.id, set: AGENCE_DEMO })
  .run();
console.log(`[seed] agence « ${AGENCE_DEMO.nom} »`);

// --- Fixtures (établissements, signaux, offres brutes, file de résolution)
const stats = seedFixtures(db);
console.log(
  `[seed] fixtures : ${stats.entreprises} entreprises, ${stats.etablissements} établissements, ` +
    `${stats.signaux} signaux, ${stats.offres} offres brutes, ${stats.resolutions} résolutions en attente`,
);
console.log("[seed] terminé — lancez `npm run score` pour calculer les leads");
