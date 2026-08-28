"use client";

import type { ReactNode } from "react";
import type { Tendance } from "@/lib/couverture/agregat";

/* ── Petites pièces de la couverture ─────────────────────────────────
   Dates, fraîcheur, tendance, sparkline, rang à barre : les mêmes
   signes dans la grille, les listes et le panneau — c'est ce qui rend
   l'écran lisible d'un coup d'œil plutôt qu'au cas par cas. */

const JOUR_MS = 86400000;

const moisLong = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const moisCourt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function jours(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / JOUR_MS));
}

/** « aujourd'hui », « il y a 3 j », « il y a 2 mois » — la fraîcheur avant la date. */
export function depuis(iso: string): string {
  const j = jours(iso);
  if (j === 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 31) return `il y a ${j} j`;
  const mois = Math.round(j / 30);
  return mois <= 1 ? "il y a 1 mois" : `il y a ${mois} mois`;
}

/** Forme courte pour les tuiles de chiffres : « 3 j », « 2 mois ». */
export function depuisCourt(iso: string): string {
  return depuis(iso).replace("il y a ", "");
}

function premierDuMois(texte: string, d: Date): string {
  return d.getDate() === 1 ? texte.replace(/^1\b/, "1er") : texte;
}

/** « 1er juin », « 24 août 2025 » : l'année ne s'écrit que si ce n'est pas la nôtre. */
export function dateLongue(iso: string): string {
  const d = new Date(iso);
  const format = d.getFullYear() === new Date().getFullYear() ? moisCourt : moisLong;
  return premierDuMois(format.format(d), d);
}

export function dateBreve(iso: string): string {
  const d = new Date(iso);
  return premierDuMois(moisCourt.format(d), d);
}

/** Trois paliers de fraîcheur : vif, tiède, éteint. */
export function fraicheur(iso: string): "vif" | "tiede" | "eteint" {
  const j = jours(iso);
  return j <= 7 ? "vif" : j <= 30 ? "tiede" : "eteint";
}

export function Pastille({ date }: { date: string }) {
  return <i className="cv-dot" data-f={fraicheur(date)} aria-hidden />;
}

/**
 * Variation d'une moitié de fenêtre à l'autre. Un rapport à une base minuscule
 * ne veut rien dire : sous deux missions dans la moitié ancienne on dit
 * « nouveau » plutôt que d'annoncer +1300 %. En mode discret (grille), seules
 * les variations franches s'affichent — le reste serait du bruit dans un
 * tableau de cent lignes.
 */
export function BadgeTendance({
  tendance,
  discret,
  titre,
}: {
  tendance: Tendance;
  discret?: boolean;
  titre?: string;
}) {
  if (!tendance) return null;
  const infobulle =
    titre ??
    `${tendance.recent} mission(s) sur la moitié récente de la fenêtre, ${tendance.precedent} sur la moitié précédente`;

  if (tendance.precedent < 2) {
    return (
      <span className="cv-tend" data-sens="hausse" title={infobulle}>
        ▲ nouveau
      </span>
    );
  }

  const pourcent = Math.round(tendance.delta * 100);
  if (Math.abs(pourcent) < (discret ? 25 : 10)) {
    return discret ? null : (
      <span className="cv-tend" data-sens="stable" title={infobulle}>
        = stable
      </span>
    );
  }

  const sens = pourcent > 0 ? "hausse" : "baisse";
  const valeur =
    pourcent > 100
      ? `×${(1 + tendance.delta).toFixed(1).replace(".", ",").replace(",0", "")}`
      : `${Math.abs(pourcent)} %`;
  return (
    <span className="cv-tend" data-sens={sens} title={infobulle}>
      {pourcent > 0 ? "▲" : "▼"} {valeur}
    </span>
  );
}

/** Volume semaine par semaine : la forme du flux, pas ses valeurs exactes. */
export function Sparkline({ serie, titre }: { serie: number[]; titre?: string }) {
  const max = Math.max(1, ...serie);
  return (
    <span className="cv-spark" title={titre} aria-hidden>
      {serie.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(8, Math.round((v / max) * 100))}%` }} data-vide={v === 0 || undefined} />
      ))}
    </span>
  );
}

/** Ligne de classement : nom, volume, barre de part, mention de fraîcheur. */
export function Rang({
  nom,
  nb,
  part,
  meta,
  onClick,
  actif,
}: {
  nom: ReactNode;
  nb: number;
  /** Part de la barre, de 0 à 1. */
  part: number;
  meta?: ReactNode;
  onClick?: () => void;
  actif?: boolean;
}) {
  const contenu = (
    <>
      <span className="nm">{nom}</span>
      <span className="nb">{nb.toLocaleString("fr-FR")}</span>
      <span className="ba">
        <span className="pt" aria-hidden>
          <i style={{ width: `${Math.max(2, Math.round(part * 100))}%` }} />
        </span>
        {meta && <span className="dt">{meta}</span>}
      </span>
    </>
  );
  if (!onClick) return <span className="cv-rang">{contenu}</span>;
  return (
    <button type="button" className="cv-rang" data-actif={actif || undefined} onClick={onClick}>
      {contenu}
    </button>
  );
}

export function Stats({ items }: { items: { valeur: ReactNode; label: string }[] }) {
  return (
    <div className="cv-stats">
      {items.map((s) => (
        <div key={s.label}>
          <b>{s.valeur}</b>
          <span>{s.label}</span>
        </div>
      ))}
    </div>
  );
}
