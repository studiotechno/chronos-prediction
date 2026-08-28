import { redirect } from "next/navigation";
import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { IconZone } from "@/components/shell/icons";
import { ZoneForm } from "@/components/onboarding/zone-form";
import { getAgence } from "@/lib/queries";
import { loadDaresTable } from "@/lib/reference/dares";
import { ROME_LABELS } from "@/lib/reference/rome";

export const dynamic = "force-dynamic";

export default async function ZonePage() {
  // Même garde que la liste : la page peut s'exécuter avant la redirection
  // du layout, qui est rendu en parallèle.
  const agence = await getAgence();
  if (!agence) redirect("/inscription");

  const secteurs = [...loadDaresTable().values()]
    .map((d) => ({ code: d.nafDivision, label: d.libelle, taux: d.tauxPct }))
    .sort((a, b) => b.taux - a.taux || a.label.localeCompare(b.label, "fr"));
  const metiers = Object.entries(ROME_LABELS)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));

  return (
    <>
      <PageChrome
        icon={<IconZone size={18} />}
        title="Ma zone de prospection"
        count={`${agence.commune ?? "commune à définir"} · ${Math.round(agence.rayonKm)} km`}
      />
      <PageBody>
        <div className="pl-wrap">
          <p className="pl-note">
            <span>
              <b>Changer la zone recalcule tout.</b> La distance à l’agence entre dans le score
              Socle, et les secteurs retenus décident des offres rapprochées : après
              enregistrement, la liste des leads décrit la nouvelle implantation, pas l’ancienne.
            </span>
          </p>
          <ZoneForm
            nomAgence={agence.nom}
            secteurs={secteurs}
            metiers={metiers}
            initiale={{
              commune: agence.commune,
              codePostal: agence.codePostal,
              departement: agence.departement,
              lat: agence.lat,
              lon: agence.lon,
              rayonKm: agence.rayonKm,
              nafCibles: agence.nafCibles ?? [],
              romeCibles: agence.romeCibles ?? [],
              nafExclus: agence.nafExclus ?? null,
            }}
          />
        </div>
      </PageBody>
    </>
  );
}
