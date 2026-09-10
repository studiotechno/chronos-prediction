"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { exigerUtilisateur, lireUtilisateur } from "@/lib/auth/session";
import { runScoring } from "@/lib/scoring/run";
import { WEIGHT_DEFAULTS } from "@/lib/scoring/weights-defaults";

const STATUTS = ["nouveau", "contacte", "qualifie", "perdu", "gagne"] as const;

/**
 * Chaque changement de statut laisse une trace datée dans `crm_outcome`, avec
 * le score et les signaux du moment : c'est le futur jeu d'entraînement —
 * quel type de signal, à quel score, a fini en RDV ou en mission.
 */
export async function updateLeadStatut(siret: string, statut: string) {
  await exigerUtilisateur();
  const parsed = z.enum(STATUTS).safeParse(statut);
  if (!parsed.success) return { ok: false as const, message: "Statut inconnu" };
  const db = getDb();
  const lead = (await db.select().from(schema.lead).where(eq(schema.lead.siret, siret)))[0];
  if (lead && lead.statut !== parsed.data) {
    await db.insert(schema.crmOutcome).values({
      id: `crm-${siret}-${Date.now().toString(36)}`,
      siret,
      evenement: parsed.data,
      date: new Date().toISOString(),
      montant: null,
      motif: null,
      scoreFinal: lead.scoreFinal,
      strate: lead.strate,
      sismo: lead.sismo,
      tempo: lead.tempo,
      topTypes: [...new Set((lead.topSignals ?? []).map((s) => s.type))].slice(0, 5),
    });
  }
  await db.update(schema.lead).set({ statut: parsed.data }).where(eq(schema.lead.siret, siret));
  revalidatePath("/");
  revalidatePath(`/lead/${siret}`);
  return { ok: true as const };
}

export async function validerResolution(formData: FormData) {
  await exigerUtilisateur();
  const id = String(formData.get("id") ?? "");
  const siret = String(formData.get("siret") ?? "");
  const db = getDb();
  const entree = (await db.select().from(schema.resolutionQueue).where(eq(schema.resolutionQueue.id, id)))[0];
  if (!entree || entree.statut !== "en_attente") return;

  const candidat = (entree.candidats ?? []).find((c) => c.siret === siret);
  if (!candidat) return;

  const etab = (await db.select().from(schema.etablissement).where(eq(schema.etablissement.siret, siret)))[0];

  await db.transaction(async (tx) => {
    await tx
      .update(schema.resolutionQueue)
      .set({ statut: "resolu", resolvedSiret: siret })
      .where(eq(schema.resolutionQueue.id, id));
    if (entree.signalId) {
      await tx
        .update(schema.signal)
        .set({ siret, siren: etab?.siren ?? siret.slice(0, 9), confidence: candidat.similarite })
        .where(eq(schema.signal.id, entree.signalId));
    }
  });

  // Le signal rattaché entre immédiatement dans le scoring
  await runScoring(db, { persist: true });
  revalidatePath("/resolution");
  revalidatePath("/");
}

export async function rejeterResolution(formData: FormData) {
  await exigerUtilisateur();
  const id = String(formData.get("id") ?? "");
  const db = getDb();
  await db
    .update(schema.resolutionQueue)
    .set({ statut: "rejete" })
    .where(eq(schema.resolutionQueue.id, id));
  revalidatePath("/resolution");
}

const poidsSchema = z.record(z.string(), z.number().finite());

export async function saveWeights(valeurs: Record<string, number>) {
  await exigerUtilisateur();
  const parsed = poidsSchema.safeParse(valeurs);
  if (!parsed.success) return { ok: false as const, message: "Poids invalides" };
  const db = getDb();
  const now = new Date().toISOString();
  const existants = new Map((await db.select().from(schema.weights)).map((w) => [w.key, w]));

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      const def = existants.get(key);
      if (!def) continue; // clé inconnue : ignorée
      const borne = Math.max(def.min, Math.min(def.max, value));
      await tx.update(schema.weights).set({ value: borne, updatedAt: now }).where(eq(schema.weights.key, key));
    }
  });

  await runScoring(db, { persist: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function resetWeights() {
  await exigerUtilisateur();
  const db = getDb();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const def of WEIGHT_DEFAULTS) {
      await tx
        .update(schema.weights)
        .set({ value: def.value, updatedAt: now })
        .where(eq(schema.weights.key, def.key));
    }
  });
  await runScoring(db, { persist: true });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/* ── Inscription et zone de prospection ─────────────────────────────
   Une seule action pour les deux : l'inscription crée la ligne agence,
   /zone la met à jour. Comme la distance à l'agence entre dans le score
   Strate, tout changement de zone relance le calcul — sinon la liste des
   leads continuerait de décrire l'ancienne implantation. */

const agenceSchema = z.object({
  nom: z.string().trim().min(2, "Nom d'agence trop court").max(80),
  responsable: z.string().trim().max(80).optional(),
  email: z.string().trim().email("Adresse email invalide").optional().or(z.literal("")),
  commune: z.string().trim().min(1),
  codePostal: z.string().trim().max(10).nullable(),
  departement: z.string().trim().max(5).nullable(),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  rayonKm: z.number().finite().min(5).max(150),
  nafCibles: z.array(z.string().trim().max(4)).max(60),
  romeCibles: z.array(z.string().trim().max(6)).max(120),
  /** Divisions (2 chiffres) ou codes NAF complets exclus du scoring ; absent = liste par défaut (78, 84). */
  nafExclus: z.array(z.string().trim().max(6)).max(60).optional(),
});

export type AgenceInput = z.infer<typeof agenceSchema>;

export async function enregistrerAgence(input: AgenceInput) {
  const parsed = agenceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Saisie invalide" };
  }
  const v = parsed.data;
  const db = getDb();
  const existante = (await db.select().from(schema.agence).limit(1))[0];

  // Seule action ouverte sans session, et seulement sur base vierge : c'est
  // l'amorçage, il n'existe alors aucun compte pour s'authentifier. Dès qu'une
  // agence existe, cette même action sert à modifier la zone — et exige donc
  // d'être connecté, sinon un inconnu déplacerait la zone de prospection.
  if (existante && !(await lireUtilisateur())) {
    return { ok: false as const, message: "Session expirée — reconnectez-vous." };
  }

  const valeurs = {
    nom: v.nom,
    responsable: v.responsable?.trim() || null,
    email: v.email?.trim() || null,
    commune: v.commune,
    codePostal: v.codePostal,
    departement: v.departement,
    lat: v.lat,
    lon: v.lon,
    rayonKm: v.rayonKm,
    nafCibles: v.nafCibles,
    romeCibles: v.romeCibles,
    ...(v.nafExclus !== undefined && {
      nafExclus: v.nafExclus.map((c) => c.replace(/[^0-9A-Za-z.]/g, "")).filter(Boolean),
    }),
  };

  if (existante) {
    await db.update(schema.agence).set(valeurs).where(eq(schema.agence.id, existante.id));
  } else {
    await db
      .insert(schema.agence)
      .values({ id: `agence-${Date.now().toString(36)}`, creeLe: new Date().toISOString(), ...valeurs });
  }

  // Le recalcul n'a de sens qu'avec des données en base : une inscription
  // sur base vierge n'a encore rien à scorer, et ce n'est pas une erreur.
  try {
    await runScoring(db, { persist: true });
  } catch (e) {
    console.warn("[agence] scoring non relancé :", e instanceof Error ? e.message : e);
  }

  revalidatePath("/", "layout");
  return { ok: true as const };
}
