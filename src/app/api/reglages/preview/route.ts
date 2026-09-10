import { NextResponse } from "next/server";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { lireUtilisateur } from "@/lib/auth/session";
import { loadEngineInput } from "@/lib/scoring/run";
import { computeAll } from "@/lib/scoring/engine";

export const dynamic = "force-dynamic";

const corps = z.object({
  weights: z.record(z.string(), z.number().finite()),
});

/** Recalcul en direct du top 20 avec des poids candidats (rien n'est persisté). */
export async function POST(req: Request) {
  // Une route d'API n'est pas couverte par la garde du layout : elle répond
  // 401 plutôt que de rediriger, l'appelant étant un fetch et non un navigateur.
  if (!(await lireUtilisateur())) {
    return NextResponse.json({ erreur: "Non authentifié" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = corps.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ erreur: "Corps invalide" }, { status: 400 });
  }

  const db = getDb();
  const input = await loadEngineInput(db, parsed.data.weights);
  const output = computeAll(input);

  const chauds = output.leads.filter((l) => l.segment === "chaud");
  const top = chauds.slice(0, 20);
  const noms =
    top.length > 0
      ? new Map(
          (
            await db
              .select({
                siret: schema.etablissement.siret,
                denomination: schema.etablissement.denomination,
                commune: schema.etablissement.commune,
              })
              .from(schema.etablissement)
              .where(inArray(schema.etablissement.siret, top.map((l) => l.siret)))
          ).map((r) => [r.siret, r]),
        )
      : new Map();

  return NextResponse.json({
    nbChauds: chauds.length,
    nbNurturing: output.leads.length - chauds.length,
    top: top.map((l) => ({
      siret: l.siret,
      denomination: noms.get(l.siret)?.denomination ?? l.siret,
      commune: noms.get(l.siret)?.commune ?? null,
      scoreFinal: l.scoreFinal,
      strate: l.strate,
      sismo: l.sismo,
      tempo: l.tempo,
    })),
  });
}
