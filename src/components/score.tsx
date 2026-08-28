import { cn } from "@/lib/utils";

/* ── Signature visuelle Chronos ──────────────────────────────────────
   Un lead se lit en un coup d'œil : le score final dans une jauge, et
   dessous les deux couches qui le produisent — ACIER (Socle, le fit
   structurel, lent) et AMBRE (Pouls, les déclencheurs datés). Le score
   final étant multiplicatif, voir les deux barres explique la note :
   une barre acier pleine et une barre ambre vide, ce n'est pas un lead. */

export function JaugeScore({
  score,
  segment,
  size = 38,
}: {
  score: number;
  /** Colore la jauge : ambre si un déclencheur a parlé, acier sinon. */
  segment: "chaud" | "nurturing";
  size?: number;
}) {
  const valeur = Math.round(score);
  const rayon = (size - 6) / 2;
  const circ = 2 * Math.PI * rayon;
  const offset = circ * (1 - Math.min(100, Math.max(0, valeur)) / 100);

  return (
    <div className="pp-gauge-sm" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle className="track" cx={size / 2} cy={size / 2} r={rayon} />
        <circle
          className="fill"
          data-zone={segment === "chaud" ? "sismo" : "strate"}
          cx={size / 2}
          cy={size / 2}
          r={rayon}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="num" style={{ fontSize: size >= 56 ? 16 : 12 }}>
        {valeur}
      </span>
    </div>
  );
}

/** Les deux couches en barres fines, empilées. */
export function BarresScore({
  strate,
  sismo,
  className,
}: {
  strate: number;
  sismo: number;
  className?: string;
}) {
  return (
    <div className={cn("pp-bars", className)}>
      <span className="pp-bar" data-couche="strate" title={`Socle ${Math.round(strate)} / 100`}>
        <i style={{ width: `${Math.min(100, Math.max(0, strate))}%` }} />
      </span>
      <span className="pp-bar" data-couche="sismo" title={`Pouls ${Math.round(sismo)} / 100`}>
        <i style={{ width: `${Math.min(100, Math.max(0, sismo))}%` }} />
      </span>
      <span className="sr-only">
        Socle {Math.round(strate)}, Pouls {Math.round(sismo)}
      </span>
    </div>
  );
}

/** Barres + chiffres — version bavarde, pour la fiche et les tuiles. */
export function CouchesScore({ strate, sismo }: { strate: number; sismo: number }) {
  return (
    <div className="pp-couches">
      <span className="pp-couche" data-couche="strate">
        <b>{Math.round(strate)}</b>
        <span className="lb">Socle</span>
        <i style={{ width: `${Math.min(100, strate)}%` }} />
      </span>
      <span className="pp-couche" data-couche="sismo">
        <b>{Math.round(sismo)}</b>
        <span className="lb">Pouls</span>
        <i style={{ width: `${Math.min(100, sismo)}%` }} />
      </span>
    </div>
  );
}

export function LegendeScores({ className }: { className?: string }) {
  return (
    <span className={cn("pp-legende", className)}>
      <span data-couche="strate">Socle — structurel</span>
      <span data-couche="sismo">Pouls — déclencheurs</span>
      <span data-couche="tempo">Tempo — le quand</span>
    </span>
  );
}

/** Le facteur Tempo en pastille : « ×1,12 », coloré seulement quand il s'écarte de 1. */
export function BadgeTempo({ tempo, className }: { tempo: number | null | undefined; className?: string }) {
  const v = Number.isFinite(tempo) ? (tempo as number) : 1;
  const sens = v > 1.02 ? "haut" : v < 0.98 ? "bas" : "plat";
  return (
    <span
      className={cn("pp-tempo", className)}
      data-sens={sens}
      title={`Tempo ${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — saison, difficultés de recrutement, conjoncture, fenêtre d'appel`}
    >
      ×{v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
