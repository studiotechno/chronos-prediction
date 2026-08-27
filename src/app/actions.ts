"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { runScoring } from "@/lib/scoring/run";
import { WEIGHT_DEFAULTS } from "@/lib/scoring/weights-defaults";

const STATUTS = ["nouveau", "contacte", "qualifie", "perdu", "gagne"] as const;

export async function updateLeadStatut(siret: string, statut: string) {
  const parsed = z.enum(STATUTS).safeParse(statut);
  if (!parsed.success) return { ok: false as const, message: "Statut inconnu" };
  const db = getDb();
  db.update(schema.lead).set({ statut: parsed.data }).where(eq(schema.lead.siret, siret)).run();
  revalidatePath("/");
  revalidatePath(`/lead/${siret}`);
  return { ok: true as const };
}

export async function validerResolution(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const siret = String(formData.get("siret") ?? "");
  const db = getDb();
  const entree = db.select().from(schema.resolutionQueue).where(eq(schema.resolutionQueue.id, id)).all()[0];
  if (!entree || entree.statut !== "en_attente") return;

  const candidat = (entree.candidats ?? []).find((c) => c.siret === siret);
  if (!candidat) return;

  const etab = db.select().from(schema.etablissement).where(eq(schema.etablissement.siret, siret)).all()[0];

  db.transaction((tx) => {
    tx.update(schema.resolutionQueue)
      .set({ statut: "resolu", resolvedSiret: siret })
      .where(eq(schema.resolutionQueue.id, id))
      .run();
    if (entree.signalId) {
      tx.update(schema.signal)
        .set({ siret, siren: etab?.siren ?? siret.slice(0, 9), confidence: candidat.similarite })
        .where(eq(schema.signal.id, entree.signalId))
        .run();
    }
  });

  // Le signal rattaché entre immédiatement dans le scoring
  runScoring(db, { persist: true });
  revalidatePath("/resolution");
  revalidatePath("/");
}

export async function rejeterResolution(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const db = getDb();
  db.update(schema.resolutionQueue)
    .set({ statut: "rejete" })
    .where(eq(schema.resolutionQueue.id, id))
    .run();
  revalidatePath("/resolution");
}

const poidsSchema = z.record(z.string(), z.number().finite());

export async function saveWeights(valeurs: Record<string, number>) {
  const parsed = poidsSchema.safeParse(valeurs);
  if (!parsed.success) return { ok: false as const, message: "Poids invalides" };
  const db = getDb();
  const now = new Date().toISOString();
  const existants = new Map(db.select().from(schema.weights).all().map((w) => [w.key, w]));

  db.transaction((tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      const def = existants.get(key);
      if (!def) continue; // clé inconnue : ignorée
      const borne = Math.max(def.min, Math.min(def.max, value));
      tx.update(schema.weights).set({ value: borne, updatedAt: now }).where(eq(schema.weights.key, key)).run();
    }
  });

  runScoring(db, { persist: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function resetWeights() {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const def of WEIGHT_DEFAULTS) {
      tx.update(schema.weights).set({ value: def.value, updatedAt: now }).where(eq(schema.weights.key, def.key)).run();
    }
  });
  runScoring(db, { persist: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
