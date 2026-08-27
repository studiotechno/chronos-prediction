"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { SIGNAL_TYPE_LABELS } from "@/lib/scoring/labels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

const TOUS = "__tous__";

export function LeadsFiltres({ nafDivisions }: { nafDivisions: { code: string; label: string }[] }) {
  const router = useRouter();
  const sp = useSearchParams();

  const setParam = useCallback(
    (cle: string, valeur: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (valeur == null || valeur === TOUS || valeur === "") next.delete(cle);
      else next.set(cle, valeur);
      router.replace(`/?${next.toString()}`, { scroll: false });
    },
    [router, sp],
  );

  const aDesFiltres = ["naf", "type", "dmax", "smin"].some((k) => sp.has(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={sp.get("naf") ?? TOUS} onValueChange={(v) => setParam("naf", v)}>
        <SelectTrigger size="sm" className="w-[190px] bg-card">
          <SelectValue placeholder="Secteur (NAF)" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUS}>Tous les secteurs</SelectItem>
          {nafDivisions.map((d) => (
            <SelectItem key={d.code} value={d.code}>
              {d.code} — {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sp.get("type") ?? TOUS} onValueChange={(v) => setParam("type", v)}>
        <SelectTrigger size="sm" className="w-[190px] bg-card">
          <SelectValue placeholder="Type de signal" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUS}>Tous les signaux</SelectItem>
          {Object.entries(SIGNAL_TYPE_LABELS)
            .filter(([t]) => t !== "MISSION_CONCURRENT")
            .map(([type, label]) => (
              <SelectItem key={type} value={type}>
                {label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Select value={sp.get("dmax") ?? TOUS} onValueChange={(v) => setParam("dmax", v)}>
        <SelectTrigger size="sm" className="w-[140px] bg-card">
          <SelectValue placeholder="Distance" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUS}>Toute distance</SelectItem>
          {[5, 10, 20, 30].map((d) => (
            <SelectItem key={d} value={String(d)}>
              ≤ {d} km
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sp.get("smin") ?? TOUS} onValueChange={(v) => setParam("smin", v)}>
        <SelectTrigger size="sm" className="w-[140px] bg-card">
          <SelectValue placeholder="Score" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TOUS}>Tout score</SelectItem>
          {[40, 50, 60, 70, 80].map((s) => (
            <SelectItem key={s} value={String(s)}>
              Score ≥ {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {aDesFiltres && (
        <Button variant="ghost" size="sm" onClick={() => router.replace("/", { scroll: false })}>
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}
