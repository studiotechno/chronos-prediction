import { signalTypeLabel } from "@/lib/scoring/labels";
import { cn } from "@/lib/utils";

/** Familles visuelles : offres (ambre), structurel (acier), risque (rouge). */
const STYLE_PAR_TYPE: Record<string, string> = {
  OFFRE_DIRECTE: "bg-sismo-soft text-sismo border-sismo/25",
  OFFRE_VELOCITE: "bg-sismo-soft text-sismo border-sismo/25",
  OFFRE_REPUBLIEE: "bg-sismo-soft text-sismo border-sismo/25",
  CDD_COURT_REPETE: "bg-sismo-soft text-sismo border-sismo/25",
  MISSION_CONCURRENT: "bg-muted text-muted-foreground border-border",
  MARCHE_ATTRIBUE: "bg-strate-soft text-strate border-strate/25",
  EFFECTIF_UP: "bg-strate-soft text-strate border-strate/25",
  BODACC_CAPITAL: "bg-strate-soft text-strate border-strate/25",
  BODACC_RISQUE: "bg-risque/10 text-risque border-risque/25",
};

export function SignalTypeBadge({ type, count }: { type: string; count?: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STYLE_PAR_TYPE[type] ?? "bg-muted text-muted-foreground border-border",
      )}
    >
      {signalTypeLabel(type)}
      {count != null && count > 1 && <span className="font-mono tabular-nums opacity-70">×{count}</span>}
    </span>
  );
}

/** Badges agrégés par type à partir des top signaux d'un lead. */
export function SignalBadges({
  topSignals,
  max = 3,
}: {
  topSignals: { type: string }[];
  max?: number;
}) {
  const parType = new Map<string, number>();
  for (const s of topSignals) parType.set(s.type, (parType.get(s.type) ?? 0) + 1);
  const entrees = [...parType.entries()].slice(0, max);
  const reste = parType.size - entrees.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {entrees.map(([type, count]) => (
        <SignalTypeBadge key={type} type={type} count={count} />
      ))}
      {reste > 0 && <span className="text-[11px] text-muted-foreground">+{reste}</span>}
    </span>
  );
}
