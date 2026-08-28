"use client";

import { useMemo } from "react";
import {
  serieHebdo,
  type EnseigneAgregat,
  type Grille,
  type MissionCouverture,
} from "@/lib/couverture/agregat";
import { dateLongue, Rang, Sparkline, Stats } from "@/components/couverture/atomes";
import type { SelectionCouverture } from "@/components/couverture/panneau";

/* ── Vue d'ensemble du bassin ────────────────────────────────────────
   Ce que montre la colonne de droite tant qu'aucun chiffre n'est
   ouvert : la forme générale du marché filtré. Les mêmes rangs que
   partout ailleurs, chacun étant une porte vers son détail. */

const RANGS_MAX = 6;

export function ResumeBassin({
  missions,
  grille,
  enseignes,
  enseigneAgence,
  libelle,
  fenetre,
  now,
  onSelection,
}: {
  missions: MissionCouverture[];
  grille: Grille;
  enseignes: EnseigneAgregat[];
  /** Nom de l'agence de l'utilisateur si elle publie, elle aussi, sur le bassin. */
  enseigneAgence: string | null;
  libelle: (rome: string) => string;
  fenetre: number;
  now: number;
  onSelection: (sel: SelectionCouverture) => void;
}) {
  const vue = useMemo(() => {
    const dates = missions.map((m) => m.date).sort();
    const trois = enseignes.slice(0, 3).reduce((s, e) => s + e.nb, 0);
    return {
      serie: serieHebdo(missions, now, fenetre),
      premiere: dates[0] ?? null,
      concentration: missions.length > 0 ? (trois / missions.length) * 100 : 0,
      nous: enseigneAgence ? (enseignes.find((e) => e.nom === enseigneAgence)?.nb ?? 0) : null,
    };
  }, [missions, enseignes, enseigneAgence, now, fenetre]);

  if (missions.length === 0) {
    return (
      <>
        <header className="cv-dt-head">
          <div className="cv-dt-id">
            <span className="cv-dt-kicker">Bassin</span>
            <h2>Rien à montrer</h2>
          </div>
        </header>
        <p className="cv-rien">Aucune mission ne correspond aux filtres actifs.</p>
      </>
    );
  }

  const topCommunes = grille.communes.slice(0, RANGS_MAX);
  const topRomes = grille.romes.slice(0, RANGS_MAX);

  return (
    <>
      <header className="cv-dt-head">
        <div className="cv-dt-id">
          <span className="cv-dt-kicker">Bassin</span>
          <h2>Vue d’ensemble</h2>
        </div>
      </header>

      <Stats
        items={[
          { valeur: missions.length.toLocaleString("fr-FR"), label: "missions" },
          { valeur: String(grille.romes.length), label: "métiers" },
          { valeur: String(grille.communes.length), label: "communes" },
        ]}
      />

      <div className="cv-flux">
        <Sparkline serie={vue.serie} titre={`Volume par semaine (${vue.serie.join(", ")})`} />
        <span className="lg">
          <span className="ct">
            3 premières enseignes : {Math.round(vue.concentration)} % du volume
          </span>
          {vue.premiere && <span className="ct">depuis le {dateLongue(vue.premiere)}</span>}
        </span>
      </div>

      {vue.nous != null && (
        <p className="cv-vous">
          Votre agence publie {vue.nous.toLocaleString("fr-FR")} mission
          {vue.nous > 1 ? "s" : ""} sur ce périmètre, soit{" "}
          {((vue.nous / missions.length) * 100).toFixed(1).replace(".", ",")} % du bassin.
        </p>
      )}

      <section className="cv-dt-sec">
        <h3>Enseignes en tête</h3>
        <ul className="cv-rangs">
          {enseignes.slice(0, 10).map((e) => (
            <li key={e.nom}>
              <Rang
                nom={
                  <>
                    {e.nom}
                    {e.nom === enseigneAgence && <span className="cv-vous-badge">vous</span>}
                  </>
                }
                nb={e.nb}
                part={e.nb / enseignes[0].nb}
                meta={`${e.part.toFixed(0)} % du bassin`}
                onClick={() => onSelection({ kind: "enseigne", nom: e.nom })}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="cv-dt-sec">
        <h3>Communes en tête</h3>
        <ul className="cv-rangs cv-rangs-plat">
          {topCommunes.map((c) => {
            const total = grille.parCommune.get(c)!;
            return (
              <li key={c}>
                <Rang
                  nom={c}
                  nb={total.nb}
                  part={total.nb / grille.maxCommune}
                  onClick={() => onSelection({ kind: "commune", commune: c })}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="cv-dt-sec">
        <h3>Métiers en tête</h3>
        <ul className="cv-rangs cv-rangs-plat">
          {topRomes.map((r) => {
            const total = grille.parRome.get(r)!;
            return (
              <li key={r}>
                <Rang
                  nom={libelle(r)}
                  nb={total.nb}
                  part={total.nb / grille.maxRome}
                  onClick={() => onSelection({ kind: "metier", rome: r })}
                />
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
