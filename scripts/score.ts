/** Recalcule Strate, Sismo et la table lead à partir des signaux en base. */
import { getDb, schema } from "../src/lib/db";
import { runScoring } from "../src/lib/scoring/run";
import { inArray } from "drizzle-orm";

const db = getDb();
const output = runScoring(db, { persist: true });

const chauds = output.leads.filter((l) => l.segment === "chaud");
const nurturing = output.leads.filter((l) => l.segment === "nurturing");
console.log(
  `[score] ${output.strates.size} établissements scorés — ${chauds.length} leads chauds, ${nurturing.length} en nurturing`,
);

const top = chauds.slice(0, 5);
if (top.length > 0) {
  const noms = new Map(
    db
      .select({ siret: schema.etablissement.siret, denomination: schema.etablissement.denomination })
      .from(schema.etablissement)
      .where(inArray(schema.etablissement.siret, top.map((l) => l.siret)))
      .all()
      .map((r) => [r.siret, r.denomination]),
  );
  console.log("[score] top 5 :");
  for (const l of top) {
    console.log(
      `  ${l.scoreFinal.toFixed(1).padStart(5)}  ${(noms.get(l.siret) ?? l.siret).padEnd(30)} strate ${l.strate.toFixed(0)} / sismo ${l.sismo.toFixed(0)}`,
    );
  }
}
