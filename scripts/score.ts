/** Recalcule Strate, Sismo, Tempo, la table lead et le snapshot du jour à partir des signaux en base. */
import "./env";
import { closeDb, getDb, schema } from "../src/lib/db";
import { runScoring } from "../src/lib/scoring/run";
import { inArray } from "drizzle-orm";

async function main() {
  const db = getDb();
  const output = await runScoring(db, { persist: true });

  const chauds = output.leads.filter((l) => l.segment === "chaud");
  const nurturing = output.leads.filter((l) => l.segment === "nurturing");
  console.log(
    `[score] ${output.strates.size} établissements scorés — ${chauds.length} leads chauds, ${nurturing.length} en nurturing`,
  );

  const top = chauds.slice(0, 10);
  if (top.length > 0) {
    const noms = new Map(
      (
        await db
          .select({
            siret: schema.etablissement.siret,
            denomination: schema.etablissement.denomination,
            naf: schema.etablissement.naf,
            commune: schema.etablissement.commune,
          })
          .from(schema.etablissement)
          .where(inArray(schema.etablissement.siret, top.map((l) => l.siret)))
      ).map((r) => [r.siret, r]),
    );
    console.log("[score] top 10 :");
    for (const l of top) {
      const e = noms.get(l.siret);
      const nom = `${e?.denomination ?? l.siret}`.slice(0, 32).padEnd(32);
      const fenetre = l.fenetre ? ` fenêtre ${l.fenetre.debut.slice(0, 10)} → ${l.fenetre.fin.slice(0, 10)}` : "";
      console.log(
        `  ${l.scoreFinal.toFixed(1).padStart(5)}  ${nom} ${(e?.naf ?? "").padEnd(6)} ${(e?.commune ?? "").slice(0, 18).padEnd(18)} S ${l.strate.toFixed(0).padStart(3)} / Si ${l.sismo.toFixed(0).padStart(3)} / T ×${l.tempo.toFixed(2)}${fenetre}`,
      );
      console.log(`         ${l.raisonFr}${l.propositionFr ? ` — ${l.propositionFr}` : ""}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
