"use client";

import { cleCellule, type Grille } from "@/lib/couverture/agregat";
import { BadgeTendance, depuis } from "@/components/couverture/atomes";
import type { SelectionCouverture } from "@/components/couverture/panneau";

/* ── Grille commune × métier ─────────────────────────────────────────
   La carte de couverture proprement dite. Chaque chiffre est cliquable :
   une case, mais aussi le total d'une commune ou d'un métier — c'est le
   même geste pour zoomer sur n'importe quel niveau de lecture. */

export function GrilleCouverture({
  grille,
  communes,
  romes,
  libelle,
  romeCibles,
  tendances,
  selection,
  onSelection,
}: {
  grille: Grille;
  /** Communes affichées (déjà coupées par les filtres d'affichage). */
  communes: string[];
  /** Métiers affichés (idem). */
  romes: string[];
  libelle: (rome: string) => string;
  romeCibles: Set<string>;
  /** Affiche les variations : faux quand l'historique ne les rend pas fiables. */
  tendances: boolean;
  selection: SelectionCouverture | null;
  onSelection: (sel: SelectionCouverture | null) => void;
}) {
  function bascule(sel: SelectionCouverture) {
    onSelection(memeSelection(selection, sel) ? null : sel);
  }

  if (communes.length === 0 || romes.length === 0) {
    return (
      <div className="cv-grille">
        <p className="cv-vide">
          Aucune mission concurrente ne correspond aux filtres. Élargissez la fenêtre, ou
          lancez <code>npm run demo</code> pour un bassin de démonstration.
        </p>
      </div>
    );
  }

  return (
    <div className="cv-grille">
      <table>
        <thead>
          <tr>
            <th className="cv-th-commune">Commune</th>
            {romes.map((rome) => {
              const total = grille.parRome.get(rome);
              const cible = romeCibles.has(rome);
              return (
                <th key={rome} className="cv-th-rome" data-cible={cible || undefined}>
                  <button
                    type="button"
                    className="cv-th-btn"
                    data-actif={
                      (selection?.kind === "metier" && selection.rome === rome) || undefined
                    }
                    title={`${libelle(rome)} — ${total?.nb ?? 0} mission(s)${
                      cible ? " · métier que vous placez" : ""
                    }`}
                    onClick={() => bascule({ kind: "metier", rome })}
                  >
                    <span className="rot">{libelle(rome)}</span>
                    <span className="cd">{rome}</span>
                  </button>
                </th>
              );
            })}
            <th className="cv-th-total" title="Toutes les missions de la commune, métiers hors affichage compris">
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {communes.map((commune) => {
            const total = grille.parCommune.get(commune);
            return (
              <tr key={commune}>
                <td className="cv-td-commune">
                  <button
                    type="button"
                    className="cv-lien-commune"
                    data-actif={
                      (selection?.kind === "commune" && selection.commune === commune) || undefined
                    }
                    title={`${commune} — ${total?.nb ?? 0} mission(s), ${
                      total?.enseignes ?? 0
                    } enseigne(s)`}
                    onClick={() => bascule({ kind: "commune", commune })}
                  >
                    {commune}
                  </button>
                </td>

                {romes.map((rome) => {
                  const cell = grille.cellules.get(cleCellule(commune, rome));
                  if (!cell) {
                    return (
                      <td key={rome} className="cv-td">
                        <div
                          className="cv-cell"
                          data-vide
                          data-cible={romeCibles.has(rome) || undefined}
                          title={`${commune} — ${libelle(rome)} : aucune mission concurrente`}
                        />
                      </td>
                    );
                  }
                  const ratio = cell.intensite / grille.maxIntensite;
                  const actif =
                    selection?.kind === "cellule" &&
                    selection.commune === commune &&
                    selection.rome === rome;
                  return (
                    <td key={rome} className="cv-td">
                      <button
                        type="button"
                        className="cv-cell"
                        data-fort={ratio > 0.55 || undefined}
                        data-actif={actif || undefined}
                        style={{
                          background: `color-mix(in srgb, var(--sismo) ${Math.round(
                            12 + ratio * 78,
                          )}%, var(--surface))`,
                        }}
                        title={`${commune} — ${libelle(rome)} : ${cell.nb} mission(s), ${
                          cell.agences.length
                        } enseigne(s), dernière ${depuis(cell.derniere)}`}
                        onClick={() => bascule({ kind: "cellule", commune, rome })}
                      >
                        {cell.nb}
                      </button>
                    </td>
                  );
                })}

                <td className="cv-td-total">
                  <button
                    type="button"
                    className="cv-total"
                    data-actif={
                      (selection?.kind === "commune" && selection.commune === commune) || undefined
                    }
                    onClick={() => bascule({ kind: "commune", commune })}
                  >
                    <span className="nb">{total?.nb ?? 0}</span>
                    <span className="pt" aria-hidden>
                      <i
                        style={{
                          width: `${Math.round(((total?.nb ?? 0) / grille.maxCommune) * 100)}%`,
                        }}
                      />
                    </span>
                    {tendances && <BadgeTendance tendance={total?.tendance ?? null} discret />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td className="cv-td-commune cv-pied">Total</td>
            {romes.map((rome) => {
              const total = grille.parRome.get(rome);
              return (
                <td key={rome} className="cv-td cv-pied">
                  <button
                    type="button"
                    className="cv-total cv-total-col"
                    title={`${libelle(rome)} — ${total?.nb ?? 0} mission(s), ${
                      total?.enseignes ?? 0
                    } enseigne(s)`}
                    onClick={() => bascule({ kind: "metier", rome })}
                  >
                    <span className="nb">{total?.nb ?? 0}</span>
                    <span className="pt" aria-hidden>
                      <i
                        style={{
                          width: `${Math.round(((total?.nb ?? 0) / grille.maxRome) * 100)}%`,
                        }}
                      />
                    </span>
                  </button>
                </td>
              );
            })}
            <td className="cv-td-total cv-pied" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function memeSelection(a: SelectionCouverture | null, b: SelectionCouverture): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "cellule" && b.kind === "cellule") {
    return a.commune === b.commune && a.rome === b.rome;
  }
  if (a.kind === "commune" && b.kind === "commune") return a.commune === b.commune;
  if (a.kind === "metier" && b.kind === "metier") return a.rome === b.rome;
  if (a.kind === "enseigne" && b.kind === "enseigne") return a.nom === b.nom;
  return false;
}
