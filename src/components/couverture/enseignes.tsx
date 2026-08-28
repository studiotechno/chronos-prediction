"use client";

import type { EnseigneAgregat } from "@/lib/couverture/agregat";
import { BadgeTendance, dateLongue, depuis, Pastille } from "@/components/couverture/atomes";
import type { SelectionCouverture } from "@/components/couverture/panneau";

/* ── Classement des enseignes ────────────────────────────────────────
   La grille dit où le marché bouge ; ce tableau dit qui le tient. Même
   jeu de missions, autre axe de lecture — et la même porte d'entrée
   vers le détail. */

export function VueEnseignes({
  enseignes,
  libelle,
  tendances,
  enseigneAgence,
  selection,
  onSelection,
}: {
  enseignes: EnseigneAgregat[];
  libelle: (rome: string) => string;
  tendances: boolean;
  /** L'agence de l'utilisateur, à distinguer des concurrents. */
  enseigneAgence: string | null;
  selection: SelectionCouverture | null;
  onSelection: (sel: SelectionCouverture) => void;
}) {
  if (enseignes.length === 0) {
    return (
      <div className="cv-grille">
        <p className="cv-vide">Aucune enseigne ne correspond aux filtres actifs.</p>
      </div>
    );
  }
  const max = enseignes[0].nb;

  return (
    <div className="cv-grille">
      <table className="cv-tbl">
        <thead>
          <tr>
            <th>Enseigne</th>
            <th className="num">Missions</th>
            <th className="num">Part</th>
            {tendances && <th>Tendance</th>}
            <th className="num">Communes</th>
            <th>Terrain principal</th>
            <th>Métier principal</th>
            <th>Présence</th>
          </tr>
        </thead>
        <tbody>
          {enseignes.map((e) => {
            const actif = selection?.kind === "enseigne" && selection.nom === e.nom;
            return (
              <tr
                key={e.nom}
                data-actif={actif || undefined}
                onClick={() => onSelection({ kind: "enseigne", nom: e.nom })}
              >
                <td>
                  <button type="button" className="cv-lien">
                    {e.nom}
                    {e.nom === enseigneAgence && <span className="cv-vous-badge">vous</span>}
                  </button>
                </td>
                <td className="num">
                  <span className="cv-mesure">
                    <b>{e.nb.toLocaleString("fr-FR")}</b>
                    <span className="pt" aria-hidden>
                      <i style={{ width: `${Math.max(2, Math.round((e.nb / max) * 100))}%` }} />
                    </span>
                  </span>
                </td>
                <td className="num mono">{e.part.toFixed(1).replace(".", ",")} %</td>
                {tendances && (
                  <td>
                    <BadgeTendance tendance={e.tendance} />
                  </td>
                )}
                <td className="num mono">{e.communes.length}</td>
                <td className="dim">
                  {e.communes[0]?.cle} <span className="cnt">{e.communes[0]?.nb}</span>
                </td>
                <td className="dim">
                  {e.metiers[0] ? libelle(e.metiers[0].cle) : "—"}{" "}
                  <span className="cnt">{e.metiers[0]?.nb}</span>
                </td>
                <td className="dim nowrap">
                  <Pastille date={e.derniere} /> {depuis(e.derniere)}
                  <br />
                  <span className="cnt">depuis le {dateLongue(e.premiere)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
