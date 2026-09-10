import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Déconnexion. Route plutôt qu'action serveur : elle sert aussi de sortie de
 * secours pour une session valide côté Supabase mais rattachée à un autre
 * compte que celui de l'agence (cf. `exigerCompteAgence`).
 *
 * POST depuis le menu de l'application, GET pour la redirection interne.
 */
async function deconnecter(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/connexion";
  // La raison est conservée pour que la page de connexion puisse l'expliquer.
  const raison = request.nextUrl.searchParams.get("raison");
  url.search = raison ? `?raison=${encodeURIComponent(raison)}` : "";
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  return deconnecter(request);
}

export async function POST(request: NextRequest) {
  return deconnecter(request);
}
