import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Chemins accessibles sans session : la connexion, la déconnexion et
// l'onboarding initial (aucun compte n'existe encore à ce moment-là).
const cheminsPublics = ["/connexion", "/inscription", "/auth/signout"];

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);
  const { pathname } = request.nextUrl;

  if (cheminsPublics.some((chemin) => pathname.startsWith(chemin))) {
    return supabaseResponse;
  }

  // Les routes d'API ne sont pas redirigées : un fetch qui suivrait la
  // redirection recevrait du HTML là où il attend du JSON. Elles portent leur
  // propre garde et répondent 401.
  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Tout sauf les fichiers servis tels quels : les assets Next, les images
     * et l'icône.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
