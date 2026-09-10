import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, serverEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

/**
 * Client Supabase à clé de service : contourne les RLS et ouvre l'API
 * d'administration (création de compte, changement de mot de passe). Réservé
 * aux scripts en ligne de commande — la clé n'est pas déployée, de sorte que
 * l'application en production ne peut ni créer ni supprimer de compte.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const serviceRoleKey = serverEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error(
      "Variables Supabase manquantes pour le client admin — " +
        "NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (gabarit : .env.example).",
    );
  }

  cached = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
