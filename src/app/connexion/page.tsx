import { redirect } from "next/navigation";
import "./connexion.css";
import { FormulaireConnexion } from "@/components/auth/formulaire-connexion";
import { lireUtilisateur } from "@/lib/auth/session";
import { getAgence } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Porte d'entrée. Trois cas, dans cet ordre : aucune agence en base — rien à
 * protéger, l'onboarding passe devant ; session déjà ouverte — on ne redemande
 * pas de s'identifier ; sinon, le formulaire.
 */
export default async function ConnexionPage() {
  const agence = await getAgence();
  if (!agence) redirect("/inscription");
  if (await lireUtilisateur()) redirect("/");

  return <FormulaireConnexion nomAgence={agence.nom} />;
}
