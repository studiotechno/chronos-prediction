/**
 * Rafraîchissement du jeton Supabase, et première barrière d'accès.
 *
 * Un jeton d'accès Supabase vit une heure. Seul un middleware ou une action
 * serveur peut écrire des cookies : sans ce passage, la session expirerait au
 * bout d'une heure de navigation, alors même que le jeton de rafraîchissement
 * est encore valable. `getUser()` déclenche la rotation, les cookies mis à jour
 * repartent avec la réponse.
 *
 * La barrière posée ici évite d'exécuter le rendu d'une page privée pour un
 * visiteur anonyme, mais elle ne remplace pas les gardes du layout, des routes
 * d'API et des actions serveur : c'est la même vérification, faite plus tôt.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { OPTIONS_COOKIE } from "@/lib/auth/cookies";

/** Chemins accessibles sans session : la connexion et l'onboarding initial. */
const PUBLICS = ["/connexion", "/inscription"];

export async function middleware(request: NextRequest) {
  let reponse = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_PUBLISHABLE_KEY;
  // Configuration absente : on laisse passer plutôt que de rendre le site
  // inaccessible sans message — les gardes serveur, elles, refuseront.
  if (!url || !cle) return reponse;

  const supabase = createServerClient(url, cle, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesAEcrire) => {
        for (const { name, value } of cookiesAEcrire) request.cookies.set(name, value);
        reponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesAEcrire) {
          reponse.cookies.set(name, value, { ...options, ...OPTIONS_COOKIE });
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const chemin = request.nextUrl.pathname;

  // Les routes d'API traversent le middleware pour le rafraîchissement du
  // jeton, mais ne sont pas redirigées : un fetch qui suit une redirection
  // recevrait du HTML là où il attend du JSON. Elles répondent 401 elles-mêmes.
  if (chemin.startsWith("/api/")) return reponse;

  if (!user && !PUBLICS.some((p) => chemin === p || chemin.startsWith(p + "/"))) {
    const versConnexion = request.nextUrl.clone();
    versConnexion.pathname = "/connexion";
    versConnexion.search = "";
    return NextResponse.redirect(versConnexion);
  }

  return reponse;
}

export const config = {
  matcher: [
    /*
     * Tout sauf les fichiers servis tels quels : les assets Next, les images et
     * l'icône. Les routes d'API sont incluses volontairement — elles lisent la
     * base et n'ont pas à répondre à un visiteur anonyme.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
