/**
 * Lecture de l'utilisateur connecté et gardes d'accès.
 *
 * Toujours `getUser()`, jamais `getSession()` : `getSession()` se contente de
 * décoder le cookie, qu'un client peut fabriquer, tandis que `getUser()` fait
 * valider le jeton par Supabase. La différence est exactement celle entre
 * « le client prétend être connecté » et « il l'est ».
 */
import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAgence } from "@/lib/queries";

export async function lireUtilisateur(): Promise<User | null> {
  const supabase = await createClient();
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

/**
 * Garde forte : un compte Supabase valide ne suffit pas, il doit être celui de
 * l'agence. Ce projet Supabase est partagé avec un autre produit et contient
 * des comptes qui n'ont rien à faire ici ; sans cette vérification, ils
 * entreraient dans les leads.
 *
 * En cas d'écart, on passe par /auth/signout : un Server Component ne peut pas
 * écrire de cookie, donc pas fermer la session lui-même — et rediriger vers
 * /connexion en gardant la session tournerait en boucle.
 */
export async function exigerCompteAgence(): Promise<User> {
  const utilisateur = await exigerUtilisateur();
  const agence = await getAgence();

  if (agence?.authUserId && agence.authUserId !== utilisateur.id) {
    redirect("/auth/signout?raison=compte-non-rattache");
  }
  return utilisateur;
}
