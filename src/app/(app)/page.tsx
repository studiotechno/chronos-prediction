import { redirect } from "next/navigation";
import { LeadsView } from "@/components/leads/leads-view";
import { getAgence, getLeads } from "@/lib/queries";
import { loadDaresTable } from "@/lib/reference/dares";
import { divisionNaf } from "@/lib/leads/filtres";

export const dynamic = "force-dynamic";

/**
 * Le fil de travail : tous les leads du bassin, chauds d'abord. Le tri et
 * le filtrage se font côté client (quelques centaines de lignes) — d'où
 * une seule lecture ici, sans paramètres d'URL.
 */
export default async function LeadsPage() {
  /* Le layout renvoie déjà vers l'inscription en l'absence d'agence, mais Next
     rend layout et page en parallèle : sans cette garde, la page s'exécute
     quand même et lève une erreur avant que la redirection ne prenne effet. */
  const agence = await getAgence();
  if (!agence) redirect("/inscription");

  const { chauds, nurturing } = await getLeads();
  const leads = [...chauds, ...nurturing];

  const dares = loadDaresTable();
  const divisions = [...new Set(leads.map((l) => divisionNaf(l.naf)))].sort();
  const nafDivisions = divisions.map((code) => ({
    code,
    label: dares.get(code)?.libelle ?? `Division ${code}`,
  }));

  return (
    <LeadsView
      leads={leads}
      agence={{
        nom: agence.nom,
        commune: agence.commune,
        lat: agence.lat,
        lon: agence.lon,
        rayonKm: agence.rayonKm,
      }}
      nafDivisions={nafDivisions}
    />
  );
}
