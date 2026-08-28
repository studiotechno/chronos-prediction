/**
 * Backtest sur étiquette proxy — la mesure qui remplace l'intuition sur les poids.
 *
 * Pour chaque jour J du journal `score_snapshot` assez ancien pour avoir un
 * horizon complet, on prend les N meilleurs leads chauds de J et on regarde si,
 * dans les `horizon` jours suivants, l'établissement a manifesté publiquement un
 * besoin de main-d'œuvre courte : CDD ≤ 3 mois, offre en manque de candidats,
 * offre multipostes, CDD courts répétés, ou marché attribué. C'est un proxy,
 * imparfait — il sert à COMPARER deux versions du moteur, jamais à annoncer une
 * précision à un client. La vraie étiquette viendra de `crm_outcome`.
 *
 * Usage : npx tsx scripts/backtest.ts --horizon=60 --top=20
 */
import "./env";
import { parseArgs } from "node:util";
import { closeDb, getDb, schema } from "../src/lib/db";

const { values } = parseArgs({
  options: {
    horizon: { type: "string" },
    top: { type: "string" },
  },
});
const HORIZON = Number(values.horizon ?? 60);
const TOP = Number(values.top ?? 20);
const JOUR_MS = 86400000;

const TYPES_BESOIN = new Set([
  "OFFRE_MANQUE_CANDIDATS",
  "OFFRE_MULTIPOSTES",
  "CDD_COURT_REPETE",
  "OFFRE_REPUBLIEE",
  "MARCHE_ATTRIBUE",
]);

async function main() {
  const db = getDb();
  const [snapshots, signaux, offres] = await Promise.all([
    db.select().from(schema.scoreSnapshot),
    db
      .select({ siret: schema.signal.siret, type: schema.signal.type, occurredAt: schema.signal.occurredAt })
      .from(schema.signal),
    db
      .select({
        siret: schema.offreBrute.siret,
        typeContrat: schema.offreBrute.typeContrat,
        duree: schema.offreBrute.dureeContratJours,
        date: schema.offreBrute.datePublication,
      })
      .from(schema.offreBrute),
  ]);

  // Événements « besoin » par SIRET, datés
  const besoins = new Map<string, number[]>();
  const ajouter = (siret: string | null, iso: string) => {
    if (!siret) return;
    const l = besoins.get(siret) ?? [];
    l.push(new Date(iso).getTime());
    besoins.set(siret, l);
  };
  for (const s of signaux) if (s.siret && TYPES_BESOIN.has(s.type)) ajouter(s.siret, s.occurredAt);
  for (const o of offres) {
    if (o.siret && o.typeContrat === "CDD" && o.duree != null && o.duree <= 90) ajouter(o.siret, o.date);
  }

  const aujourdhui = Date.now();
  const parJour = new Map<string, typeof snapshots>();
  for (const s of snapshots) {
    const l = parJour.get(s.jour) ?? [];
    l.push(s);
    parJour.set(s.jour, l);
  }
  const jours = [...parJour.keys()].sort().filter((j) => new Date(j).getTime() + HORIZON * JOUR_MS <= aujourdhui);

  if (jours.length === 0) {
    const premier = [...parJour.keys()].sort()[0];
    console.log(
      `[backtest] pas encore d'historique évaluable : ${parJour.size} jour(s) de snapshots` +
        (premier ? `, le premier du ${premier}` : "") +
        ` ; il faut ${HORIZON} jours d'horizon après un snapshot. Le cron quotidien s'en charge.`,
    );
    return;
  }

  const aUnBesoin = (siret: string, jour: string) => {
    const t0 = new Date(jour).getTime();
    const t1 = t0 + HORIZON * JOUR_MS;
    return (besoins.get(siret) ?? []).some((t) => t > t0 && t <= t1);
  };

  console.log(`[backtest] horizon ${HORIZON} j, top ${TOP} — ${jours.length} jour(s) évaluable(s)`);
  console.log("  jour        top hits  précision  base   lift");
  let sommePrecision = 0;
  let sommeLift = 0;
  for (const jour of jours) {
    const du = parJour.get(jour)!;
    const chauds = du.filter((s) => s.segment === "chaud").sort((a, b) => b.scoreFinal - a.scoreFinal);
    const top = chauds.slice(0, TOP);
    if (top.length === 0) continue;
    const hits = top.filter((s) => aUnBesoin(s.siret, jour)).length;
    const precision = hits / top.length;
    // Base : taux de besoin sur tous les établissements scorés ce jour-là
    const base = du.filter((s) => aUnBesoin(s.siret, jour)).length / Math.max(1, du.length);
    const lift = base > 0 ? precision / base : NaN;
    sommePrecision += precision;
    sommeLift += Number.isFinite(lift) ? lift : 0;
    console.log(
      `  ${jour}  ${String(top.length).padStart(3)} ${String(hits).padStart(4)}  ${(precision * 100).toFixed(0).padStart(7)} %  ${(base * 100).toFixed(1).padStart(5)} %  ${Number.isFinite(lift) ? "×" + lift.toFixed(1) : "—"}`,
    );
  }
  console.log(
    `[backtest] moyenne : précision@${TOP} ${((sommePrecision / jours.length) * 100).toFixed(0)} %, lift ×${(sommeLift / jours.length).toFixed(1)}`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
