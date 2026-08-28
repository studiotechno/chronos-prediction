"use client";

import { useMemo } from "react";
import {
  agregerEnseignes,
  serieHebdo,
  tendance,
  type MissionCouverture,
} from "@/lib/couverture/agregat";
import { intituleLisible } from "@/lib/couverture/libelles";
import {
  BadgeTendance,
  dateBreve,
  dateLongue,
  depuis,
  depuisCourt,
  Pastille,
  Rang,
  Sparkline,
  Stats,
} from "@/components/couverture/atomes";

/* ── Panneau de détail ───────────────────────────────────────────────
   Tout chiffre de l'écran s'ouvre ici : une case, une commune entière,
   un métier entier, une enseigne. Le panneau ne connaît que les
   missions DÉJÀ filtrées — ce qu'il raconte est donc toujours ce que la
   grille montre, jamais un autre périmètre. */

export type SelectionCouverture =
  | { kind: "cellule"; commune: string; rome: string }
  | { kind: "commune"; commune: string }
  | { kind: "metier"; rome: string }
  | { kind: "enseigne"; nom: string };

/** Nombre de missions listées dans le pied du panneau. */
const MISSIONS_MAX = 14;
/** Longueur des classements internes au panneau. */
const RANGS_MAX = 8;

export function retientMission(m: MissionCouverture, sel: SelectionCouverture): boolean {
  switch (sel.kind) {
    case "cellule":
      return m.commune === sel.commune && m.rome === sel.rome;
    case "commune":
      return m.commune === sel.commune;
    case "metier":
      return m.rome === sel.rome;
    case "enseigne":
      return m.agence === sel.nom;
  }
}

export function Panneau({
  selection,
  missions,
  libelle,
  fenetre,
  now,
  tendances,
  retour,
  onNaviguer,
  onFermer,
}: {
  selection: SelectionCouverture;
  /** Missions filtrées du bassin (toutes vues confondues). */
  missions: MissionCouverture[];
  libelle: (rome: string) => string;
  fenetre: number;
  now: number;
  /** Affiche la variation : faux quand l'historique ne la rend pas fiable. */
  tendances: boolean;
  retour: { label: string; onClick: () => void } | null;
  onNaviguer: (sel: SelectionCouverture) => void;
  onFermer: () => void;
}) {
  const retenues = useMemo(
    () => missions.filter((m) => retientMission(m, selection)),
    [missions, selection],
  );

  const vue = useMemo(() => {
    const enseignes = agregerEnseignes(retenues, { now, fenetreJours: fenetre });
    const communes = compter(retenues, (m) => m.commune);
    const metiers = compter(retenues, (m) => m.rome);
    const dates = retenues.map((m) => m.date).sort();
    return {
      enseignes,
      communes,
      metiers,
      premiere: dates[0] ?? null,
      derniere: dates[dates.length - 1] ?? null,
      tendance: tendance(retenues, now, fenetre),
      serie: serieHebdo(retenues, now, fenetre),
      recentes: [...retenues].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MISSIONS_MAX),
    };
  }, [retenues, now, fenetre]);

  if (retenues.length === 0 || !vue.premiere || !vue.derniere) {
    return (
      <>
        <EnTete titre="Rien à cet endroit" kicker="Détail" retour={retour} onFermer={onFermer} />
        <p className="cv-rien">
          Aucune mission ne correspond à cette sélection avec les filtres actifs.
        </p>
      </>
    );
  }

  const titres = intitulesPanneau(selection, libelle);
  const monoEnseigne = vue.enseignes.length === 1;

  return (
    <>
      <EnTete {...titres} retour={retour} onFermer={onFermer} />

      <Stats
        items={[
          { valeur: retenues.length.toLocaleString("fr-FR"), label: "missions" },
          selection.kind === "enseigne"
            ? { valeur: String(vue.communes.length), label: "communes" }
            : { valeur: String(vue.enseignes.length), label: "enseignes" },
          { valeur: depuisCourt(vue.derniere), label: "dernière" },
        ]}
      />

      <div className="cv-flux">
        <Sparkline
          serie={vue.serie}
          titre={`Volume par semaine sur ${fenetre} jours (${vue.serie.join(", ")})`}
        />
        <span className="lg">
          {tendances && <BadgeTendance tendance={vue.tendance} />}
          <span className="ct">depuis le {dateLongue(vue.premiere)}</span>
        </span>
      </div>

      {selection.kind !== "enseigne" && (
        <Section titre="Qui met des missions">
          {vue.enseignes.slice(0, RANGS_MAX).map((e) => (
            <li key={e.nom}>
              <Rang
                nom={e.nom}
                nb={e.nb}
                part={e.nb / vue.enseignes[0].nb}
                meta={
                  <>
                    <Pastille date={e.derniere} /> {depuis(e.derniere)}
                    <span className="sep">·</span> depuis le {dateLongue(e.premiere)}
                  </>
                }
                onClick={() => onNaviguer({ kind: "enseigne", nom: e.nom })}
              />
            </li>
          ))}
        </Section>
      )}

      {selection.kind !== "commune" && selection.kind !== "cellule" && (
        <Section titre="Communes">
          {vue.communes.slice(0, RANGS_MAX).map((c) => (
            <li key={c.cle}>
              <Rang
                nom={c.cle}
                nb={c.nb}
                part={c.nb / vue.communes[0].nb}
                onClick={() =>
                  onNaviguer(
                    selection.kind === "metier"
                      ? { kind: "cellule", commune: c.cle, rome: selection.rome }
                      : { kind: "commune", commune: c.cle },
                  )
                }
              />
            </li>
          ))}
        </Section>
      )}

      {selection.kind !== "metier" && selection.kind !== "cellule" && (
        <Section titre="Métiers">
          {vue.metiers.slice(0, RANGS_MAX).map((r) => (
            <li key={r.cle}>
              <Rang
                nom={libelle(r.cle)}
                nb={r.nb}
                part={r.nb / vue.metiers[0].nb}
                onClick={() =>
                  onNaviguer(
                    selection.kind === "commune"
                      ? { kind: "cellule", commune: selection.commune, rome: r.cle }
                      : { kind: "metier", rome: r.cle },
                  )
                }
              />
            </li>
          ))}
        </Section>
      )}

      <section className="cv-dt-sec">
        <h3>
          Dernières missions
          {retenues.length > MISSIONS_MAX && (
            <span className="hint">{MISSIONS_MAX} sur {retenues.length.toLocaleString("fr-FR")}</span>
          )}
        </h3>
        <ul className="cv-missions">
          {vue.recentes.map((m, i) => (
            <li key={`${m.date}-${i}`}>
              <span className="ti">{intituleLisible(m.intitule)}</span>
              <span className="me">
                {!monoEnseigne && selection.kind !== "enseigne" && (
                  <>
                    <b>{m.agence}</b>
                    <span className="sep">·</span>
                  </>
                )}
                {selection.kind === "enseigne" && (
                  <>
                    <b>{m.commune}</b>
                    <span className="sep">·</span>
                  </>
                )}
                {dateBreve(m.date)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function intitulesPanneau(
  sel: SelectionCouverture,
  libelle: (rome: string) => string,
): { kicker: string; titre: string; code?: string } {
  switch (sel.kind) {
    case "cellule":
      return { kicker: sel.commune, titre: libelle(sel.rome), code: sel.rome };
    case "commune":
      return { kicker: "Commune", titre: sel.commune };
    case "metier":
      return { kicker: "Métier", titre: libelle(sel.rome), code: sel.rome };
    case "enseigne":
      return { kicker: "Enseigne", titre: sel.nom };
  }
}

function compter(
  missions: MissionCouverture[],
  cle: (m: MissionCouverture) => string,
): { cle: string; nb: number }[] {
  const acc = new Map<string, number>();
  for (const m of missions) acc.set(cle(m), (acc.get(cle(m)) ?? 0) + 1);
  return [...acc.entries()]
    .map(([c, nb]) => ({ cle: c, nb }))
    .sort((a, b) => b.nb - a.nb);
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="cv-dt-sec">
      <h3>{titre}</h3>
      <ul className="cv-rangs">{children}</ul>
    </section>
  );
}

export function EnTete({
  kicker,
  titre,
  code,
  retour,
  onFermer,
}: {
  kicker: string;
  titre: string;
  code?: string;
  retour: { label: string; onClick: () => void } | null;
  onFermer: () => void;
}) {
  return (
    <header className="cv-dt-head">
      <div className="cv-dt-id">
        {retour ? (
          <button type="button" className="cv-dt-retour" onClick={retour.onClick}>
            ← {retour.label}
          </button>
        ) : (
          <span className="cv-dt-kicker">{kicker}</span>
        )}
        <h2>{titre}</h2>
        {code && <span className="cv-dt-code">{code}</span>}
      </div>
      <button type="button" className="cv-dt-close" onClick={onFermer} aria-label="Fermer le détail">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M3.5 3.5l7 7M10.5 3.5l-7 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </header>
  );
}
