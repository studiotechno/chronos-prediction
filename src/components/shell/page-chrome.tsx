"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useShellUi } from "@/components/shell/app-shell";
import { IconBurger } from "@/components/shell/icons";

/* ── Chrome de page ──────────────────────────────────────────────────
   Deux bandes sticky hors du scroll : titre + compteur + actions, puis
   FILTRES. Le contenu de la page défile dessous. Toutes les pages en
   passent par là — c'est ce qui fait qu'on reconnaît l'outil d'un écran
   à l'autre. */

export function PageChrome({
  icon,
  title,
  count,
  parent,
  actions,
  filters,
  filtersLabel = "Filtres",
  filtersRight,
}: {
  icon: ReactNode;
  title: string;
  /** Ex. « 113 leads » — la mesure qui qualifie la page. */
  count?: ReactNode;
  /** Fil d'Ariane d'une sous-page (fiche entreprise). */
  parent?: { label: string; href: string };
  actions?: ReactNode;
  filters?: ReactNode;
  /** Intitulé de la bande basse ; « Filtres » sauf contenu d'une autre nature. */
  filtersLabel?: string;
  filtersRight?: ReactNode;
}) {
  const { openDrawer } = useShellUi();

  return (
    <div className="dchrome">
      <div className="dchrome-head">
        <button
          type="button"
          className="dchrome-btn sb-burger"
          onClick={openDrawer}
          aria-label="Ouvrir le menu"
        >
          <IconBurger size={14} />
        </button>
        <span className="dchrome-icon">{icon}</span>
        {parent && (
          <>
            <Link href={parent.href} className="dchrome-crumb">
              {parent.label}
            </Link>
            <span className="dchrome-count" aria-hidden>
              ›
            </span>
          </>
        )}
        <span className="dchrome-title">{title}</span>
        {count != null && <span className="dchrome-count">{count}</span>}
        {actions && <div className="dchrome-actions">{actions}</div>}
      </div>

      {filters && (
        <div className="dchrome-filters">
          <span className="dchrome-lead">{filtersLabel}</span>
          <div className="dchrome-scroll">{filters}</div>
          {filtersRight && <div className="dchrome-fright">{filtersRight}</div>}
        </div>
      )}
    </div>
  );
}

/** Corps de page : le chrome déborde de son padding par marges négatives. */
export function PageBody({
  children,
  bleed,
}: {
  children: ReactNode;
  /** Vue plein cadre (carte, tableau) : le contenu prend tout l'espace
      libre, bord à bord, et défile lui-même. */
  bleed?: boolean;
}) {
  return <div className={bleed ? "shell-page shell-page--bleed" : "shell-page"}>{children}</div>;
}
