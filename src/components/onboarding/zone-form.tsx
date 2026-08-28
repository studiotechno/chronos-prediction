"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { enregistrerAgence } from "@/app/actions";
import { ZoneEditor, type ZoneInitiale, type ZonePayload } from "@/components/onboarding/zone-editor";

/* ── Modification de la zone ─────────────────────────────────────────
   Même éditeur qu'à l'inscription. Enregistrer relance le scoring : la
   distance à l'agence pèse dans le Strate, donc déplacer la zone change
   la liste des leads — l'écran le dit avant, et le confirme après. */

export function ZoneForm({
  nomAgence,
  initiale,
  secteurs,
  metiers,
}: {
  nomAgence: string;
  initiale: ZoneInitiale;
  secteurs: { code: string; label: string; taux: number }[];
  metiers: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [enregistre, setEnregistre] = useState(false);

  async function sauver(zone: ZonePayload) {
    const res = await enregistrerAgence({ nom: nomAgence, ...zone });
    if (!res.ok) throw new Error(res.message);
    setEnregistre(true);
    router.refresh();
  }

  return (
    <>
      {enregistre && (
        <p className="oz-ok">
          Zone enregistrée — les scores viennent d’être recalculés avec la nouvelle implantation.
        </p>
      )}
      <ZoneEditor
        initiale={initiale}
        secteurs={secteurs}
        metiers={metiers}
        saveLabel="Enregistrer et recalculer les scores"
        onSave={sauver}
      />
    </>
  );
}
