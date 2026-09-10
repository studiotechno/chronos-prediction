import { redirect } from "next/navigation";
import "./connexion.css";
import { FormulaireConnexion } from "@/components/auth/formulaire-connexion";
import { lireUtilisateur } from "@/lib/auth/session";
import { getAgence } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Porte d'entrée. Trois cas, dans cet ordre : aucune agence en base — rien à
 * protéger, l'onboarding passe devant ; session déjà ouverte SUR LE BON COMPTE
 * — on ne redemande pas de s'identifier ; sinon, le formulaire.
 */
export default async function ConnexionPage({
  searchParams,
}: {
  searchParams: Promise<{ raison?: string }>;
}) {
  const agence = await getAgence();
  if (!agence) redirect("/inscription");

  const utilisateur = await lireUtilisateur();
  // Une session ouverte sur un compte étranger à l'agence ne doit pas renvoyer
  // vers l'application : elle en serait rejetée, et la boucle s'installerait.
  if (utilisateur && (!agence.authUserId || agence.authUserId === utilisateur.id)) {
    redirect("/");
  }

  const { raison } = await searchParams;
  return <FormulaireConnexion nomAgence={agence.nom} raison={raison} />;
}
