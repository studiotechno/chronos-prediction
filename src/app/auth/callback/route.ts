import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Retour des liens envoyés par email (réinitialisation de mot de passe).
 *
 * Deux formes de lien existent selon le gabarit d'email configuré dans
 * Supabase, et on accepte les deux plutôt que d'imposer un réglage :
 *
 *   • `?code=…` — flux PKCE, celui que produit le client navigateur par
 *     défaut : le code s'échange contre une session.
 *   • `?token_hash=…&type=recovery` — gabarit d'email « nouvelle manière »
 *     (`{{ .TokenHash }}`), vérifié côté serveur.
 *
 * En cas d'échec, retour à la connexion avec un motif lisible plutôt qu'une
 * page d'erreur technique : un lien périmé est le cas courant, pas un incident.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const suite = searchParams.get("next") ?? "/nouveau-mot-de-passe";

  const supabase = await createClient();

  let echec: string | null = "lien-invalide";
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    echec = error ? "lien-expire" : null;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    echec = error ? "lien-expire" : null;
  }

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = echec ? "/connexion" : suite;
  if (echec) url.search = `?raison=${echec}`;
  return NextResponse.redirect(url);
}
