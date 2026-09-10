import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Rafraîchit la session Supabase et renvoie l'utilisateur.
 *
 * Un jeton d'accès vit une heure. Seuls un middleware ou une action serveur
 * peuvent écrire des cookies : sans ce passage, la session expirerait en cours
 * de navigation alors que le jeton de rafraîchissement est encore valable.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() fait valider le jeton par Supabase — contrairement à
  // getSession(), qui se contente de décoder un cookie que le client peut
  // fabriquer. En cas de panne réseau seulement, on retombe sur le cookie
  // plutôt que de déconnecter tout le monde parce que Supabase a hoqueté.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    const { data } = await supabase.auth.getSession();
    user = data.session?.user ?? null;
  }

  return { user, supabaseResponse, supabase };
}
