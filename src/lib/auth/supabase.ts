/**
 * Clients Supabase Auth.
 *
 * L'authentification est entièrement côté serveur : le formulaire passe par une
 * action serveur, jamais par le navigateur. La clé publiable ne quitte donc
 * jamais la fonction — d'où des variables SANS préfixe `NEXT_PUBLIC_`, qui
 * resteraient sinon inscrites en clair dans le bundle client.
 *
 * Supabase Auth gère la base `auth.users`, le hachage des mots de passe, les
 * jetons JWT et leur rotation ; l'application ne stocke aucun secret de compte.
 * La table `agence` ne garde qu'un lien : `auth_user_id`.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { OPTIONS_COOKIE } from "@/lib/auth/cookies";

export function urlSupabase(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL manquante — renseignez-la dans .env (gabarit : .env.example).");
  }
  return url;
}

export function clePubliable(): string {
  const cle = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!cle) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY manquante — clé « publishable » du projet Supabase " +
        "(Project settings → API keys), à renseigner dans .env.",
    );
  }
  return cle;
}

/**
 * Client lié aux cookies de la requête en cours. À utiliser dans les Server
 * Components, les actions serveur et les routes d'API.
 */
export async function clientServeur() {
  const jar = await cookies();

  return createServerClient(urlSupabase(), clePubliable(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookiesAEcrire) => {
        try {
          for (const { name, value, options } of cookiesAEcrire) {
            jar.set(name, value, { ...options, ...OPTIONS_COOKIE });
          }
        } catch {
          // Appel depuis un Server Component, qui n'a pas le droit d'écrire de
          // cookie : sans conséquence, le rafraîchissement du jeton est assuré
          // par le middleware, lui autorisé à en poser.
        }
      },
    },
  });
}
