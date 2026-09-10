/**
 * Lecture de l'utilisateur connecté et garde d'accès.
 *
 * Toujours `getUser()`, jamais `getSession()` : `getSession()` se contente de
 * décoder le cookie, qu'un client peut fabriquer, tandis que `getUser()` fait
 * valider le jeton par Supabase. La différence est exactement celle entre
 * « le client prétend être connecté » et « il l'est ».
 */
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { clientServeur } from "@/lib/auth/supabase";

export async function lireUtilisateur(): Promise<User | null> {
  const supabase = await clientServeur();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/**
 * Garde des pages, des routes d'API et des actions serveur : renvoie
 * l'utilisateur ou coupe court vers la connexion. À appeler dans TOUTE action
 * serveur qui écrit — une action serveur est une route HTTP publique, que la
 * page qui la déclenche soit protégée ou non.
 */
export async function exigerUtilisateur(): Promise<User> {
  const utilisateur = await lireUtilisateur();
  if (!utilisateur) redirect("/connexion");
  return utilisateur;
}
