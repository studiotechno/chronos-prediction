/**
 * Recalcule les métiers induits (`signal.romes`) des signaux de marchés publics
 * à partir de leur payload déjà stocké.
 *
 * Pourquoi ce script existe : un signal fige ses métiers au moment de
 * l'ingestion, et la contrainte d'unicité `(source, raw_ref)` fait qu'une
 * ré-ingestion ne les met pas à jour. Corriger une règle de déduction dans
 * `src/lib/reference/metiers.ts` ne rattrape donc pas les signaux déjà en base :
 * il faut les repasser. C'est exactement ce que fait ce script — une mise à
 * jour sur place, sans rien supprimer, réexécutable autant de fois qu'on veut.
 *
 * Usage : npx tsx scripts/reparer-metiers.ts [--appliquer]
 * Sans `--appliquer`, il montre ce qu'il changerait et n'écrit rien.
 */
import "./env";
import { parseArgs } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/lib/db";
import { romesDeCpv, romesDeLibelleMarche } from "../src/lib/reference/metiers";

const { values } = parseArgs({ options: { appliquer: { type: "boolean" } } });
const appliquer = values.appliquer === true;

/** Le descripteur BOAMP est stocké tantôt en tableau, tantôt en chaîne JSON. */
function libelles(payload: Record<string, unknown> | null): string[] {
  const brut = payload?.descripteur;
  const out: string[] = [];
  if (Array.isArray(brut)) out.push(...brut.filter((x): x is string => typeof x === "string"));
  else if (typeof brut === "string") {
    try {
      const parsed = JSON.parse(brut);
      if (Array.isArray(parsed)) out.push(...parsed.filter((x): x is string => typeof x === "string"));
      else out.push(brut);
    } catch {
      out.push(brut);
    }
  }
  if (typeof payload?.objet === "string") out.push(payload.objet);
  return out;
}

function memes(a: string[] | null, b: string[]): boolean {
  const x = a ?? [];
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function main() {
  const db = getDb();
  const signaux = await db
    .select()
    .from(schema.signal)
    .where(inArray(schema.signal.type, ["MARCHE_ATTRIBUE", "AO_OUVERT"]));

  let inchanges = 0;
  const changements: { id: string; avant: string[]; apres: string[]; quoi: string }[] = [];

  for (const s of signaux) {
    const p = s.payload ?? null;
    // Le CPV du DECP est plus fiable qu'un libellé : on le préfère quand il existe.
    const cpv = typeof p?.cpv === "string" ? p.cpv : null;
    const parCpv = romesDeCpv(cpv);
    const romes = parCpv.length > 0 ? parCpv : romesDeLibelleMarche(libelles(p));
    if (memes(s.romes, romes)) {
      inchanges++;
      continue;
    }
    changements.push({
      id: s.id,
      avant: s.romes ?? [],
      apres: romes,
      quoi: String(p?.objet ?? "").slice(0, 64),
    });
  }

  console.log(
    `[metiers] ${signaux.length} signaux de marchés — ${inchanges} inchangés, ${changements.length} à corriger`,
  );
  for (const c of changements.slice(0, 15)) {
    console.log(
      `  ${(c.avant.join(",") || "—").padEnd(28)} → ${(c.apres.join(",") || "aucun métier").padEnd(28)} ${c.quoi}`,
    );
  }
  if (changements.length > 15) console.log(`  … et ${changements.length - 15} autres`);

  if (!appliquer) {
    console.log("[metiers] simulation — relancez avec --appliquer pour écrire");
    return;
  }
  for (const c of changements) {
    await db.update(schema.signal).set({ romes: c.apres }).where(eq(schema.signal.id, c.id));
  }
  console.log(`[metiers] ${changements.length} signaux mis à jour — lancez \`npm run score\``);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
