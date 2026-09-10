import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

/**
 * Client lié aux cookies de la requête. À utiliser dans les Server Components,
 * les actions serveur et les routes d'API.
 *
 * Important avec Fluid Compute : ne jamais mémoriser ce client dans une
 * variable globale — une instance de fonction sert plusieurs requêtes, et le
 * client emporterait les cookies de la précédente. On en crée un par appel.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Appel depuis un Server Component, qui n'a pas le droit d'écrire de
          // cookie : sans conséquence, le middleware rafraîchit la session.
        }
      },
    },
  });
}
