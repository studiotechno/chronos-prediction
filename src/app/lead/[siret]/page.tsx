import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeadDetail } from "@/lib/queries";
import { nafLabel } from "@/lib/reference/naf";
import { trancheByCode } from "@/lib/reference/tranches";
import { tauxRecoursInterim } from "@/lib/reference/dares";
import { dateCourte, dateRelative, siretFormate } from "@/lib/format";
import { SignalTypeBadge } from "@/components/signal-badges";
import { StatutSelect } from "@/components/statut-select";
import { cn } from "@/lib/utils";
import type { ScoreComponent } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

function BarreComposante({
  c,
  couleur,
  total,
}: {
  c: ScoreComponent;
  couleur: "strate" | "sismo";
  total: number;
}) {
  const negatif = c.contribution < 0;
  const largeur = c.max
    ? Math.min(100, (Math.abs(c.contribution) / c.max) * 100)
    : Math.min(100, (Math.abs(c.contribution) / Math.max(1, total)) * 100);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={cn(negatif && "text-risque")}>{c.labelFr}</span>
        <span className={cn("font-mono text-xs tabular-nums", negatif ? "text-risque" : "text-muted-foreground")}>
          {negatif ? "" : "+"}
          {c.contribution.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
          {c.max ? ` / ${c.max}` : ""}
        </span>
      </div>
      <div className={cn("h-1.5 rounded-full overflow-hidden", couleur === "strate" ? "bg-strate-soft" : "bg-sismo-soft")}>
        <div
          className={cn("h-full rounded-full", negatif ? "bg-risque" : couleur === "strate" ? "bg-strate" : "bg-sismo")}
          style={{ width: `${largeur}%` }}
        />
      </div>
      {c.detailFr && <p className="text-xs text-muted-foreground">{c.detailFr}</p>}
    </div>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ siret: string }> }) {
  const { siret } = await params;
  const detail = getLeadDetail(siret);
  if (!detail) notFound();

  const { etab, lead, strate, sismo, signaux, distanceKm } = detail;
  const tranche = trancheByCode(etab.trancheEffectif);
  const taux = tauxRecoursInterim(etab.naf);
  const totalSismoPositif = (sismo?.components ?? [])
    .filter((c) => c.contribution > 0)
    .reduce((s, c) => s + c.contribution, 0);

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Retour aux leads
      </Link>

      {/* ------------------------------------------------ En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{etab.denomination}</h1>
            {lead && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                  lead.segment === "chaud"
                    ? "bg-sismo-soft text-sismo border-sismo/30"
                    : "bg-muted text-muted-foreground border-border",
                )}
              >
                {lead.segment === "chaud" ? "Lead chaud" : "Nurturing"}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {nafLabel(etab.naf)} ({etab.naf}) · {etab.commune} ({etab.codePostal})
            {tranche ? ` · ${tranche.labelFr}` : ""}
            {distanceKm != null ? ` · ${distanceKm.toLocaleString("fr-FR")} km de l'agence` : ""}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            SIRET {siretFormate(etab.siret)}
            {etab.dateCreation ? ` · créé en ${etab.dateCreation.slice(0, 4)}` : ""}
            {" · "}taux de recours intérim du secteur : {taux.toLocaleString("fr-FR")} %
          </p>
        </div>
        {lead && <StatutSelect siret={etab.siret} statut={lead.statut} />}
      </div>

      {/* ------------------------------------------------ Raison d'appeler */}
      {lead && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm leading-relaxed",
            lead.segment === "chaud" ? "border-sismo/30 bg-sismo-soft/40" : "bg-card",
          )}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Pourquoi appeler</p>
          {lead.raisonFr}
        </div>
      )}

      {/* ------------------------------------------------ Scores */}
      <section className="rounded-lg border bg-card p-4 space-y-5">
        <div className="flex items-end gap-8 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Score final</p>
            <p className="font-mono text-4xl font-semibold tabular-nums leading-none mt-1">
              {lead ? Math.round(lead.scoreFinal) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-strate">Strate — structurel</p>
            <p className="font-mono text-2xl font-semibold tabular-nums leading-none mt-1 text-strate">
              {strate ? Math.round(strate.score) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-sismo">Sismo — déclencheurs</p>
            <p className="font-mono text-2xl font-semibold tabular-nums leading-none mt-1 text-sismo">
              {sismo ? Math.round(sismo.score) : "—"}
            </p>
          </div>
          <p className="text-xs text-muted-foreground ml-auto max-w-[260px]">
            Score final = 100 × (Strate/100)<sup>α</sup> × (Sismo/100)<sup>β</sup>. Multiplicatif :
            un des deux à zéro annule le tout.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-x-10 gap-y-5">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-strate">Décomposition Strate</h3>
            {(strate?.components ?? []).map((c) => (
              <BarreComposante key={c.key} c={c} couleur="strate" total={100} />
            ))}
            {!strate && <p className="text-sm text-muted-foreground">Pas encore scoré.</p>}
          </div>
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-sismo">Décomposition Sismo</h3>
            {(sismo?.components ?? []).map((c) => (
              <BarreComposante key={c.key} c={c} couleur="sismo" total={totalSismoPositif} />
            ))}
            {sismo && sismo.components?.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun signal scorable.</p>
            )}
            {sismo && (
              <p className="text-xs text-muted-foreground">
                Contributions brutes avant normalisation logistique (somme :{" "}
                {sismo.components?.reduce((s, c) => s + c.contribution, 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
                ).
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Timeline des signaux */}
      <section className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold mb-4">
          Timeline des signaux <span className="text-muted-foreground font-normal">({signaux.length})</span>
        </h3>
        {signaux.length === 0 && <p className="text-sm text-muted-foreground">Aucun signal pour cet établissement.</p>}
        <ol className="relative space-y-0">
          {signaux.map((s, i) => (
            <li key={s.id} className="relative pl-6 pb-5 last:pb-0">
              {i < signaux.length - 1 && (
                <span className="absolute left-[5px] top-3 bottom-0 w-px bg-border" aria-hidden />
              )}
              <span
                className={cn(
                  "absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-card",
                  s.type === "BODACC_RISQUE"
                    ? "bg-risque"
                    : s.type.startsWith("OFFRE") || s.type === "CDD_COURT_REPETE"
                      ? "bg-sismo"
                      : "bg-strate",
                )}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs tabular-nums text-muted-foreground w-24">
                  {dateCourte(s.occurredAt)}
                </span>
                <SignalTypeBadge type={s.type} />
                <span className="text-sm">{s.resumeFr}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 ml-[104px]">
                {dateRelative(s.occurredAt)} · source {s.source.replace("fixture:", "")}
                {s.source.startsWith("fixture:") ? " (fixture)" : ""}
                {s.confidence < 1 ? ` · rapprochement à ${Math.round(s.confidence * 100)} %` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
