"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { clientServeur } from "@/lib/auth/supabase";

/* ── Connexion et déconnexion ────────────────────────────────────────
   Supabase Auth porte les comptes, le hachage des mots de passe et les
   jetons ; l'application ne conserve qu'un lien `agence.auth_user_id`.
   Tout passe par le serveur : le mot de passe n'est jamais manipulé par du
   JavaScript de page, et la clé publiable ne descend pas dans le bundle. */

const connexionSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  motDePasse: z.string().min(1).max(200),
});

export type ResultatConnexion = { ok: false; message: string };

export async function connexion(_precedent: unknown, formData: FormData): Promise<ResultatConnexion> {
  const parsed = connexionSchema.safeParse({
    email: formData.get("email"),
    motDePasse: formData.get("motDePasse"),
  });

  // Message unique pour tous les refus : distinguer « email inconnu » de « mot
  // de passe faux » dirait à un inconnu quelles adresses existent.
  const REFUS: ResultatConnexion = { ok: false, message: "Email ou mot de passe incorrect." };
  if (!parsed.success) return REFUS;

  const supabase = await clientServeur();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.motDePasse,
  });
  if (error || !data.user) return REFUS;

  // Compte Supabase valide ne vaut pas accès : seul le compte rattaché à
  // l'agence entre. Un utilisateur créé par ailleurs dans le même projet
  // Supabase se voit refuser la porte, et sa session est refermée.
  const db = getDb();
  const agence = (await db.select().from(schema.agence).limit(1))[0];
  if (!agence || agence.authUserId !== data.user.id) {
    await supabase.auth.signOut();
    return { ok: false, message: "Ce compte n’est rattaché à aucune agence." };
  }

  redirect("/");
}

export async function deconnexion(): Promise<void> {
  const supabase = await clientServeur();
  await supabase.auth.signOut();
  redirect("/connexion");
}
