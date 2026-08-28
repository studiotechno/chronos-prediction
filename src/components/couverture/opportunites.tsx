"use client";

import Link from "next/link";
import type { Opportunite } from "@/lib/couverture/agregat";
import { BadgeTendance, depuis, Pastille } from "@/components/couverture/atomes";
import type { SelectionCouverture } from "@/components/couverture/panneau";

/* ── Terrain à prendre ───────────────────────────────────────────────
   La grille montre tout le bassin ; cette vue ne garde que les métiers
   que l'agence place. Une case chaude chez les concurrents dit qu'il y
   a de la demande à cet endroit — et une case muette sur un métier
   qu'on place n'est pas une bonne nouvelle, c'est un endroit où
   personne ne trouve de marché. Quand l'agence publie elle aussi sur la
   source, la colonne « vous » tranche : un zéro en face d'un volume
   concurrent, c'est un angle mort net. */

export function VueOpportunites({
  opportunites,
  sansEcho,
  libelle,
  tendances,
  aDesCibles,
  connaitNotreAgence,
  selection,
  onSelection,
}: {
  opportunites: Opportunite[];
  sansEcho: { rome: string; libelle: string }[];
  libelle: (rome: string) => string;
  tendances: boolean;
  aDesCibles: boolean;
  /** Vrai quand l'agence se reconnaît dans les données : la colonne « vous » a un sens. */
  connaitNotreAgence: boolean;
  selection: SelectionCouverture | null;
  onSelection: (sel: SelectionCouverture) => void;
}) {
  if (!aDesCibles) {
    return (
      <div className="cv-grille">
        <p className="cv-vide">
          Cette vue compare le bassin aux métiers que vous placez — ils ne sont pas encore
          renseignés. Ajoutez-les dans <Link href="/zone">votre zone</Link>, et le terrain à prendre
          se remplira tout seul.
        </p>
      </div>
    );
  }

  const max = Math.max(1, ...opportunites.map((o) => o.concurrents));

  return (
    <div className="cv-opp">
      <div className="cv-grille">
        <table className="cv-tbl">
          <thead>
            <tr>
              <th>Commune</th>
              <th>Métier que vous placez</th>
              <th className="num">Concurrents</th>
              {connaitNotreAgence && <th className="num">Vous</th>}
              {tendances && <th>Tendance</th>}
              <th>Enseigne dominante</th>
              <th>Dernière</th>
            </tr>
          </thead>
          <tbody>
            {opportunites.map((o) => {
              const actif =
                selection?.kind === "cellule" &&
                selection.commune === o.commune &&
                selection.rome === o.rome;
              return (
                <tr
                  key={`${o.commune}-${o.rome}`}
                  data-actif={actif || undefined}
                  onClick={() => onSelection({ kind: "cellule", commune: o.commune, rome: o.rome })}
                >
                  <td>
                    <button type="button" className="cv-lien">
                      {o.commune}
                    </button>
                  </td>
                  <td className="dim">{libelle(o.rome)}</td>
                  <td className="num">
                    <span className="cv-mesure">
                      <b>{o.concurrents}</b>
                      <span className="pt" aria-hidden>
                        <i
                          style={{
                            width: `${Math.max(2, Math.round((o.concurrents / max) * 100))}%`,
                          }}
                        />
                      </span>
                    </span>
                  </td>
                  {connaitNotreAgence && (
                    <td className="num mono">
                      {o.nous === 0 ? <span className="cv-absent">0</span> : o.nous}
                    </td>
                  )}
                  {tendances && (
                    <td>
                      <BadgeTendance tendance={o.tendance} />
                    </td>
                  )}
                  <td className="dim">
                    {o.dominante ? (
                      <>
                        {o.dominante.nom} <span className="cnt">{o.dominante.nb}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="dim nowrap">
                    <Pastille date={o.derniere} /> {depuis(o.derniere)}
                  </td>
                </tr>
              );
            })}
            {opportunites.length === 0 && (
              <tr>
                <td colSpan={6 + (tendances ? 1 : 0) + (connaitNotreAgence ? 1 : 0)} className="cv-vide">
                  Aucun de vos métiers n’a de mission concurrente sur cette fenêtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sansEcho.length > 0 && (
        <aside className="cv-sansecho">
          <h2>Sans écho sur la fenêtre</h2>
          <p>
            Vos métiers dont aucun concurrent n’a publié ici : marché à créer, ou métier que le
            bassin ne demande pas.
          </p>
          <ul>
            {sansEcho.map((m) => (
              <li key={m.rome}>
                <span className="nm">{m.libelle}</span>
                <span className="cd">{m.rome}</span>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
