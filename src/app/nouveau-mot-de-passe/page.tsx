import { redirect } from "next/navigation";
import "../connexion/connexion.css";
import { FormulaireNouveauMotDePasse } from "@/components/auth/formulaire-nouveau-mot-de-passe";
import { lireUtilisateur } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Choix d'un nouveau mot de passe, atteignable uniquement avec la session
 * ouverte par le lien reçu par email. Sans session, on renvoie à la demande de
 * lien plutôt que d'afficher un formulaire qui ne pourrait rien enregistrer.
 */
export default async function NouveauMotDePassePage() {
  if (!(await lireUtilisateur())) redirect("/mot-de-passe-oublie");
  return <FormulaireNouveauMotDePasse />;
}
