import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { getShellData } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Coquille de l'application connectée. L'absence d'agence en base signifie
 * qu'aucune inscription n'a eu lieu : l'outil n'a alors ni zone ni contexte,
 * et renvoie vers l'inscription plutôt que d'afficher des écrans vides.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { agence, counts, demo } = await getShellData();
  if (!agence) redirect("/inscription");

  const sousTitre = [agence.commune, `${Math.round(agence.rayonKm)} km`].filter(Boolean).join(" · ");

  return (
    <AppShell
      agence={{
        nom: agence.nom,
        sousTitre: sousTitre || "Zone à définir",
        initiale: agence.nom.trim().charAt(0).toUpperCase() || "C",
      }}
      counts={counts}
      demo={demo}
    >
      {children}
    </AppShell>
  );
}
