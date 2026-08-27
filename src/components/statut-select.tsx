"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateLeadStatut } from "@/app/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUTS = [
  { value: "nouveau", label: "Nouveau" },
  { value: "contacte", label: "Contacté" },
  { value: "qualifie", label: "Qualifié" },
  { value: "perdu", label: "Perdu" },
  { value: "gagne", label: "Gagné" },
];

export function StatutSelect({ siret, statut }: { siret: string; statut: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Select
      value={statut}
      disabled={pending}
      onValueChange={(v) =>
        startTransition(async () => {
          await updateLeadStatut(siret, v);
          router.refresh();
        })
      }
    >
      <SelectTrigger size="sm" className="w-[130px] bg-card">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUTS.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
