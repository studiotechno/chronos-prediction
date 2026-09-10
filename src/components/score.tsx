import { cn } from "@/lib/utils";

/* ── Signature visuelle Chronos ──────────────────────────────────────
   Le relevé de score. Un score final n'est pas une note posée d'en haut,
   c'est un PRODUIT : ACIER (Socle, le fit structurel, lent) × AMBRE
   (Pouls, les déclencheurs datés). Un cadran circulaire donne le résultat
   et escamote l'opération ; le relevé la garde sous les yeux — le chiffre
   contre le filet de son segment, et dessous les deux couches qui l'ont
   fabriqué. Socle plein et Pouls vide, ce n'est pas un lead : ça se lit
   sans un mot. */

export function LectureScore({
  score,
  strate,
  sismo,
  segment,
  className,
}: {
  score: number;
  strate: number;
  sismo: number;
  /** Colore le filet : ambre si un déclencheur a parlé, acier sinon. */
  segment: "chaud" | "nurturing";
  className?: string;
}) {
  const borne = (v: number) => Math.min(100, Math.max(0, v));

  return (
    <span className={cn("pp-lect", className)} data-segment={segment}>
      <b className="v">{Math.round(score)}</b>
      <span className="bars" aria-hidden>
        <span className="pp-bar" data-couche="strate" title={`Socle ${Math.round(strate)} / 100`}>
          <i style={{ width: `${borne(strate)}%` }} />
        </span>
        <span className="pp-bar" data-couche="sismo" title={`Pouls ${Math.round(sismo)} / 100`}>
          <i style={{ width: `${borne(sismo)}%` }} />
        </span>
      </span>
      <span className="sr-only">
        Socle {Math.round(strate)}, Pouls {Math.round(sismo)}
      </span>
    </span>
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
