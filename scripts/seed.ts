/**
 * Seed : poids par défaut, agence de démo, et (par défaut) fixtures.
 * Idempotent : ré-exécutable sans dupliquer (upserts + unicité signal(source, raw_ref)).
 *
 * `--sans-fixtures` prépare une base destinée aux données RÉELLES : les poids
 * seulement, aucune donnée fictive et AUCUNE agence — c'est l'inscription dans
 * l'application qui crée la zone. Point de départ d'un déploiement :
 * npm run db:seed -- --sans-fixtures, inscription, puis npm run ingest:all.
 *
 * Dans les deux modes, une agence déjà inscrite n'est jamais écrasée : un
 * re-seed ne doit pas effacer la zone de prospection en place.
 */
import { parseArgs } from "node:util";
import "./env";
import { closeDb, getDb, schema } from "../src/lib/db";
import { WEIGHT_DEFAULTS } from "../src/lib/scoring/weights-defaults";
import { AGENCE_DEMO } from "../src/lib/fixtures/agence";
import { seedFixtures } from "../src/lib/fixtures/seed-fixtures";

const { values } = parseArgs({ options: { "sans-fixtures": { type: "boolean" } } });
const avecFixtures = !values["sans-fixtures"];

async function main() {
  const db = getDb();
  const now = new Date().toISOString();

  // --- Poids (n'écrase pas une valeur modifiée via /reglages, met à jour bornes et libellés)
  for (const w of WEIGHT_DEFAULTS) {
    await db
      .insert(schema.weights)
      .values({ ...w, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.weights.key,
        set: { min: w.min, max: w.max, labelFr: w.labelFr, descriptionFr: w.descriptionFr },
      });
  }
  console.log(`[seed] ${WEIGHT_DEFAULTS.length} poids`);

  // --- Agence
  //
  // La ligne `agence` n'est jamais posée d'office : son absence est ce qui
  // déclenche l'inscription dans l'application. Le seed de démo la crée donc
  // seulement si la base n'en a pas — un re-seed ne doit pas écraser la zone
  // qu'un utilisateur vient de définir dans /zone.
  const agenceExistante = (await db.select().from(schema.agence).limit(1))[0];

  // --- Fixtures (établissements, signaux, offres brutes, file de résolution)
  if (avecFixtures) {
    if (agenceExistante) {
      console.log(`[seed] agence « ${agenceExistante.nom} » conservée (zone inchangée)`);
    } else {
      await db.insert(schema.agence).values(AGENCE_DEMO);
      console.log(`[seed] agence « ${AGENCE_DEMO.nom} »`);
    }

    const stats = await seedFixtures(db);
    console.log(
      `[seed] fixtures : ${stats.entreprises} entreprises, ${stats.etablissements} établissements, ` +
        `${stats.signaux} signaux, ${stats.offres} offres brutes, ${stats.resolutions} résolutions en attente`,
    );
    console.log("[seed] terminé — lancez `npm run score` pour calculer les leads");
  } else {
    console.log("[seed] sans fixtures : base prête pour des données réelles");
    if (agenceExistante) {
      console.log(`[seed] agence « ${agenceExistante.nom} » déjà inscrite`);
      console.log("[seed] terminé — lancez `npm run ingest:all` puis `npm run score`");
    } else {
      // Le scoring a besoin d'une zone (la distance à l'agence entre dans Strate) :
      // l'inscription passe avant, et se fait dans l'application.
      console.log("[seed] aucune agence : inscrivez-la dans l'application (`npm run dev`, /inscription)");
      console.log("[seed] terminé — puis `npm run ingest:all` et `npm run score`");
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
