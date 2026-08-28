"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveWeights, resetWeights } from "@/app/actions";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PoidsRow = {
  key: string;
  value: number;
  min: number;
  max: number;
  labelFr: string;
  descriptionFr: string;
};

type PreviewLead = {
  siret: string;
  denomination: string;
  commune: string | null;
  scoreFinal: number;
  strate: number;
  sismo: number;
  tempo?: number;
};

type Preview = { nbChauds: number; nbNurturing: number; top: PreviewLead[] };

const estNoyau = (k: string) =>
  k.startsWith("sismo.pic.") || k.startsWith("sismo.largeur.") || k === "sismo.plancher_retard";

const GROUPES: {
  titre: string;
  teinte: "strate" | "sismo" | "tempo" | "neutre";
  test: (k: string) => boolean;
}[] = [
  { titre: "Socle — fit structurel", teinte: "strate", test: (k) => k.startsWith("strate.") },
  { titre: "Pouls — poids des signaux", teinte: "sismo", test: (k) => k.startsWith("sismo.poids.") },
  { titre: "Pouls — demi-vies (jours)", teinte: "sismo", test: (k) => k.startsWith("sismo.demivie.") },
  { titre: "Pouls — noyaux à retard", teinte: "sismo", test: estNoyau },
  {
    titre: "Pouls — normalisation, secteur et corroboration",
    teinte: "sismo",
    test: (k) =>
      k.startsWith("sismo.") && !k.startsWith("sismo.poids.") && !k.startsWith("sismo.demivie.") && !estNoyau(k),
  },
  { titre: "Tempo — le quand", teinte: "tempo", test: (k) => k.startsWith("tempo.") },
  { titre: "Score final", teinte: "neutre", test: (k) => k.startsWith("final.") },
];

export function PoidsEditeur({
  poids,
  topInitial,
}: {
  poids: PoidsRow[];
  topInitial: { siret: string }[];
}) {
  const router = useRouter();
  const [valeurs, setValeurs] = useState<Record<string, number>>(
    () => Object.fromEntries(poids.map((p) => [p.key, p.value])),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [enCalcul, setEnCalcul] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const rangInitial = useMemo(
    () => new Map(topInitial.map((l, i) => [l.siret, i + 1])),
    [topInitial],
  );

  const modifie = useMemo(
    () => poids.some((p) => valeurs[p.key] !== p.value),
    [poids, valeurs],
  );

  const rafraichir = useCallback((prochaines: Record<string, number>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setEnCalcul(true);
      try {
        const res = await fetch("/api/reglages/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weights: prochaines }),
          signal: ctrl.signal,
        });
        if (res.ok) setPreview(await res.json());
      } catch {
        // recalcul suivant en route : rien à faire
      } finally {
        if (abortRef.current === ctrl) setEnCalcul(false);
      }
    }, 300);
  }, []);

  // Premier calcul au montage pour afficher le top 20 courant
  useEffect(() => {
    rafraichir(valeurs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changer = (key: string, v: number) => {
    const prochaines = { ...valeurs, [key]: v };
    setValeurs(prochaines);
    setEnregistre(false);
    rafraichir(prochaines);
  };

  return (
    <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
      {/* ------------------------------------------------ Sliders */}
      <div className="space-y-6">
        {GROUPES.map((g) => {
          const lignes = poids.filter((p) => g.test(p.key));
          if (lignes.length === 0) return null;
          return (
            <section key={g.titre} className="rounded-lg border bg-card overflow-hidden">
              <h2
                className={cn(
                  "px-4 py-2.5 text-sm font-semibold border-b",
                  g.teinte === "strate" && "text-strate bg-strate-dim",
                  g.teinte === "sismo" && "text-sismo bg-sismo-dim",
                  g.teinte === "tempo" && "text-tempo bg-tempo-dim",
                )}
              >
                {g.titre}
              </h2>
              <div className="divide-y">
                {lignes.map((p) => (
                  <div key={p.key} className="px-4 py-3 grid sm:grid-cols-[240px_1fr_70px] gap-x-4 gap-y-1 items-center">
                    <div>
                      <p className="text-sm leading-tight">{p.labelFr}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug mt-0.5" title={p.descriptionFr}>
                        {p.descriptionFr.length > 90 ? `${p.descriptionFr.slice(0, 90)}…` : p.descriptionFr}
                      </p>
                    </div>
                    <Slider
                      value={[valeurs[p.key]]}
                      min={p.min}
                      max={p.max}
                      step={stepPour(p)}
                      onValueChange={([v]) => changer(p.key, v)}
                      aria-label={p.labelFr}
                    />
                    <span
                      className={cn(
                        "font-mono text-sm tabular-nums text-right",
                        valeurs[p.key] !== p.value && "font-semibold text-sismo",
                      )}
                    >
                      {valeurs[p.key].toLocaleString("fr-FR")}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* ------------------------------------------------ Aperçu top 20 */}
      <aside className="lg:sticky lg:top-16 rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Impact en direct — top 20</h2>
            {preview && (
              <p className="text-xs text-muted-foreground">
                {preview.nbChauds} chauds · {preview.nbNurturing} tièdes
              </p>
            )}
          </div>
          <span
            className={cn(
              "h-2 w-2 rounded-full transition-colors",
              enCalcul ? "bg-sismo animate-pulse" : "bg-green",
            )}
            title={enCalcul ? "Recalcul…" : "À jour"}
          />
        </div>
        <ol className="divide-y max-h-[520px] overflow-y-auto">
          {(preview?.top ?? []).map((l, i) => {
            const avant = rangInitial.get(l.siret);
            const delta = avant != null ? avant - (i + 1) : null;
            return (
              <li key={l.siret} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground w-5 text-right">{i + 1}</span>
                <span className="w-8 text-[11px] font-mono tabular-nums">
                  {delta == null ? (
                    <span className="text-sismo">nouv.</span>
                  ) : delta > 0 ? (
                    <span className="text-green">▲{delta}</span>
                  ) : delta < 0 ? (
                    <span className="text-chaud">▼{-delta}</span>
                  ) : (
                    <span className="text-muted-foreground">=</span>
                  )}
                </span>
                <span className="flex-1 truncate">
                  {l.denomination}
                  <span className="text-xs text-muted-foreground"> · {l.commune}</span>
                </span>
                {l.tempo != null && Number.isFinite(l.tempo) && (
                  <span
                    className="font-mono text-[10.5px] tabular-nums text-tempo"
                    title={`Tempo ×${l.tempo.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  >
                    ×{l.tempo.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
                <span className="font-mono text-sm font-semibold tabular-nums">{Math.round(l.scoreFinal)}</span>
              </li>
            );
          })}
          {!preview && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Calcul du classement…</li>
          )}
        </ol>
        <div className="px-4 py-3 border-t flex items-center gap-2">
          <Button
            size="sm"
            disabled={!modifie || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await saveWeights(valeurs);
                if (r.ok) {
                  setEnregistre(true);
                  router.refresh();
                }
              })
            }
          >
            {pending ? "Enregistrement…" : "Enregistrer et recalculer"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await resetWeights();
                router.refresh();
                window.location.reload();
              })
            }
          >
            Réinitialiser
          </Button>
          {enregistre && !modifie && <span className="text-xs text-green">Enregistré ✓</span>}
        </div>
      </aside>
    </div>
  );
}

function stepPour(p: PoidsRow): number {
  const etendue = p.max - p.min;
  if (etendue <= 2) return 0.05;
  if (etendue <= 10) return 0.1;
  if (etendue >= 10000) return 10000;
  return 1;
}
