import { cn } from "@/lib/utils";

/**
 * Signature visuelle Chronos : le score final accompagné des deux couches qui le
 * composent — Strate (acier, structurel) au-dessus de Sismo (ambre, événementiel).
 */
export function ScoreDual({
  final,
  strate,
  sismo,
  className,
}: {
  final: number;
  strate: number;
  sismo: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="font-mono text-lg font-semibold tabular-nums w-9 text-right">
        {Math.round(final)}
      </span>
      <div className="flex flex-col gap-[3px] w-14" aria-hidden>
        <div className="h-[5px] rounded-full bg-strate-soft overflow-hidden">
          <div className="h-full rounded-full bg-strate" style={{ width: `${Math.min(100, strate)}%` }} />
        </div>
        <div className="h-[5px] rounded-full bg-sismo-soft overflow-hidden">
          <div className="h-full rounded-full bg-sismo" style={{ width: `${Math.min(100, sismo)}%` }} />
        </div>
      </div>
      <span className="sr-only">
        Score final {Math.round(final)}, Strate {Math.round(strate)}, Sismo {Math.round(sismo)}
      </span>
    </div>
  );
}

export function LegendeScores({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-strate" />
        Strate (structurel)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full bg-sismo" />
        Sismo (déclencheurs)
      </span>
    </div>
  );
}
