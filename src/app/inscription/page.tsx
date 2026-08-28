import { redirect } from "next/navigation";
import { Inscription } from "@/components/onboarding/inscription";
import { getAgence } from "@/lib/queries";
import { loadDaresTable } from "@/lib/reference/dares";
import { ROME_LABELS } from "@/lib/reference/rome";

export const dynamic = "force-dynamic";

/**
 * Point d'entrée d'une agence qui découvre l'outil. Si une agence existe
 * déjà, le paramétrage est fait : on renvoie vers les leads plutôt que de
 * proposer d'écraser la zone par accident (elle se modifie via /zone).
 */
export default async function InscriptionPage() {
  if (await getAgence()) redirect("/");

  const dares = [...loadDaresTable().values()]
    .map((d) => ({ code: d.nafDivision, label: d.libelle, taux: d.tauxPct }))
    .sort((a, b) => b.taux - a.taux || a.label.localeCompare(b.label, "fr"));

  const metiers = Object.entries(ROME_LABELS)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));

  return (
    <Inscription
      secteurs={dares}
      metiers={metiers}
      // Une agence généraliste commence rarement ailleurs : les six
      // secteurs où l'intérim pèse le plus, et tous les métiers connus du
      // référentiel. Tout reste décochable.
      secteursSuggeres={dares.slice(0, 6).map((d) => d.code)}
      metiersSuggeres={metiers.map((m) => m.code)}
    />
  );
}
