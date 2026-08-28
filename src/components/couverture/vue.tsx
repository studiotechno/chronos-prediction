"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { useSearchShortcut } from "@/components/shell/app-shell";
import {
  DfClearAll,
  DfDropdown,
  DfOption,
  DfPopFooter,
  DfRange,
  DfSeparator,
  DfToggle,
  DfViewSwitch,
} from "@/components/shell/filters";
import { IconCouverture, IconListe, IconRecherche, IconZone } from "@/components/shell/icons";
import { useStoredString } from "@/lib/client-state";
import { romeLabel } from "@/lib/reference/rome";
import {
  agregerEnseignes,
  construireGrille,
  metiersSansEcho,
  opportunites as calculerOpportunites,
  tendancesFiables,
  type MissionCouverture,
  type TriCouverture,
} from "@/lib/couverture/agregat";
import {
  appliquerFiltres,
  CLE_FILTRES,
  CLE_VUE,
  FENETRES,
  FILTRES_DEFAUT,
  filtresActifs,
  parseFiltres,
  serialiserFiltres,
  type FiltresCouverture,
  type VueCouverture,
} from "@/lib/couverture/filtres";
import { GrilleCouverture } from "@/components/couverture/grille";
import { VueEnseignes } from "@/components/couverture/enseignes";
import { VueOpportunites } from "@/components/couverture/opportunites";
import { Panneau, type SelectionCouverture } from "@/components/couverture/panneau";
import { ResumeBassin } from "@/components/couverture/resume";

/* ── Écran de couverture ─────────────────────────────────────────────
   Les missions du bassin sont chargées une fois ; tout le reste — la
   fenêtre lue, les enseignes retenues, le tri, la vue — se règle ici et
   se recalcule en mémoire. Trois angles sur le même jeu : la grille
   commune × métier, le classement des enseignes, et le terrain à
   prendre sur les métiers que l'agence place. */

const LIBELLES_TRI: Record<TriCouverture, string> = {
  volume: "volume",
  tendance: "tendance",
  alpha: "alphabétique",
};

export function Couverture({
  missions,
  enseigneAgence,
  libellesRome,
  romeCibles,
  demiVie,
  total,
  tronque,
}: {
  missions: MissionCouverture[];
  /** L'agence de l'utilisateur, si elle publie elle aussi sur le bassin. */
  enseigneAgence: string | null;
  libellesRome: Record<string, string>;
  romeCibles: string[];
  demiVie: number;
  /** Volume total en base, avant plafonnement éventuel. */
  total: number;
  tronque: boolean;
}) {
  const [vueBrute, setVueBrute] = useStoredString(CLE_VUE, "grille");
  const vue = (["grille", "enseignes", "opportunites"] as const).includes(vueBrute as VueCouverture)
    ? (vueBrute as VueCouverture)
    : "grille";
  const [filtresBruts, setFiltresBruts] = useStoredString(CLE_FILTRES, "");
  const filtres = useMemo(() => parseFiltres(filtresBruts), [filtresBruts]);
  const [selection, setSelection] = useState<SelectionCouverture | null>(null);
  const [historique, setHistorique] = useState<SelectionCouverture[]>([]);
  const champRecherche = useRef<HTMLInputElement>(null);

  useSearchShortcut(useCallback(() => champRecherche.current?.focus(), []));

  const now = useMemo(() => Date.now(), []);
  const libelle = useCallback(
    (rome: string) => libellesRome[rome] ?? romeLabel(rome),
    [libellesRome],
  );
  const cibles = useMemo(() => new Set(romeCibles), [romeCibles]);

  function setFiltres(next: FiltresCouverture) {
    setFiltresBruts(serialiserFiltres(next));
  }

  /** Facettes des enseignes : comptées sans le filtre d'enseignes, sinon
      cocher la première ferait disparaître toutes les autres du popover. */
  const facettes = useMemo(() => {
    const base = appliquerFiltres(
      missions,
      { ...filtres, enseignes: [] },
      { now, romeCibles, libelles: libellesRome },
    );
    const acc = new Map<string, number>();
    for (const m of base) acc.set(m.agence, (acc.get(m.agence) ?? 0) + 1);
    return [...acc.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr"));
  }, [missions, filtres, now, romeCibles, libellesRome]);

  const retenues = useMemo(
    () => appliquerFiltres(missions, filtres, { now, romeCibles, libelles: libellesRome }),
    [missions, filtres, now, romeCibles, libellesRome],
  );

  const grille = useMemo(
    () =>
      construireGrille(retenues, {
        now,
        demiVie,
        fenetreJours: filtres.fenetre,
        tri: filtres.tri,
        libelles: libellesRome,
      }),
    [retenues, now, demiVie, filtres.fenetre, filtres.tri, libellesRome],
  );

  const enseignes = useMemo(
    () => agregerEnseignes(retenues, { now, fenetreJours: filtres.fenetre }),
    [retenues, now, filtres.fenetre],
  );

  const romesAffiches = useMemo(() => {
    const gardes = grille.romes.filter(
      (r) => (grille.parRome.get(r)?.nb ?? 0) >= Math.max(1, filtres.seuil),
    );
    return filtres.colonnes > 0 ? gardes.slice(0, filtres.colonnes) : gardes;
  }, [grille, filtres.colonnes, filtres.seuil]);

  const communesAffichees = useMemo(
    () => (filtres.lignes > 0 ? grille.communes.slice(0, filtres.lignes) : grille.communes),
    [grille, filtres.lignes],
  );

  const opportunites = useMemo(
    () =>
      calculerOpportunites(grille, retenues, romeCibles, {
        now,
        fenetreJours: filtres.fenetre,
        enseigneAgence,
      }),
    [grille, retenues, romeCibles, now, filtres.fenetre, enseigneAgence],
  );

  /* Les offres closes sortent de la source : sur une fenêtre trop profonde pour
     l'historique réellement collecté, toute tendance dirait la collecte plutôt
     que le marché. On préfère alors ne pas en afficher. */
  const tendances = useMemo(
    () => tendancesFiables(retenues, now, filtres.fenetre),
    [retenues, now, filtres.fenetre],
  );

  const sansEcho = useMemo(
    () => metiersSansEcho(grille, romeCibles, libellesRome),
    [grille, romeCibles, libellesRome],
  );

  function naviguer(sel: SelectionCouverture) {
    setHistorique((h) => (selection ? [...h, selection] : h));
    setSelection(sel);
  }

  function revenir() {
    setHistorique((h) => {
      const precedent = h[h.length - 1];
      if (precedent) setSelection(precedent);
      return h.slice(0, -1);
    });
  }

  function choisir(sel: SelectionCouverture | null) {
    setHistorique([]);
    setSelection(sel);
  }

  const actifs = filtresActifs(filtres);
  const masques = grille.romes.length - romesAffiches.length;
  const compteur = [
    `${retenues.length.toLocaleString("fr-FR")}${
      actifs ? ` sur ${total.toLocaleString("fr-FR")}` : ""
    } mission${retenues.length > 1 ? "s" : ""}`,
    `${enseignes.length} enseigne${enseignes.length > 1 ? "s" : ""}`,
    `${grille.communes.length} commune${grille.communes.length > 1 ? "s" : ""}`,
  ].join(" · ");

  return (
    <>
      <PageChrome
        icon={<IconCouverture size={18} />}
        title="Couverture du bassin"
        count={compteur}
        actions={<Legende />}
        filters={
          <>
            <DfViewSwitch
              value={vue}
              onChange={(v) => setVueBrute(v)}
              options={[
                { id: "grille" as const, title: "Grille commune × métier", icon: <IconCouverture /> },
                { id: "enseignes" as const, title: "Classement des enseignes", icon: <IconListe /> },
                { id: "opportunites" as const, title: "Terrain à prendre", icon: <IconZone /> },
              ]}
            />
            <DfSeparator />

            <span className="df-search">
              <IconRecherche size={14} />
              <input
                ref={champRecherche}
                value={filtres.q}
                onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
                placeholder="Commune, métier, enseigne…"
                aria-label="Rechercher dans la couverture"
              />
            </span>

            <DfDropdown
              label="Fenêtre"
              value={`${filtres.fenetre} jours`}
              applied={filtres.fenetre !== FILTRES_DEFAUT.fenetre}
              width={200}
            >
              {(close) => (
                <>
                  {FENETRES.map((f) => (
                    <DfOption
                      key={f}
                      label={`${f} derniers jours`}
                      selected={filtres.fenetre === f}
                      onClick={() => {
                        setFiltres({ ...filtres, fenetre: f });
                        close();
                      }}
                    />
                  ))}
                </>
              )}
            </DfDropdown>

            <DfDropdown
              label="Enseigne"
              value={
                filtres.enseignes.length === 0
                  ? "toutes"
                  : filtres.enseignes.length === 1
                    ? filtres.enseignes[0]
                    : `${filtres.enseignes.length} enseignes`
              }
              applied={filtres.enseignes.length > 0}
              badge={filtres.enseignes.length}
              width={300}
            >
              {(close) => (
                <>
                  <div className="df-scrollzone">
                    {facettes.map(([nom, n]) => (
                      <DfOption
                        key={nom}
                        multi
                        label={nom}
                        count={n}
                        selected={filtres.enseignes.includes(nom)}
                        onClick={() =>
                          setFiltres({
                            ...filtres,
                            enseignes: filtres.enseignes.includes(nom)
                              ? filtres.enseignes.filter((e) => e !== nom)
                              : [...filtres.enseignes, nom],
                          })
                        }
                      />
                    ))}
                  </div>
                  <DfPopFooter
                    onClear={() => setFiltres({ ...filtres, enseignes: [] })}
                    onApply={close}
                  />
                </>
              )}
            </DfDropdown>

            <DfDropdown
              label="Tri"
              value={LIBELLES_TRI[filtres.tri]}
              applied={filtres.tri !== FILTRES_DEFAUT.tri}
              width={220}
            >
              {(close) => (
                <>
                  {(Object.keys(LIBELLES_TRI) as TriCouverture[]).map((t) => (
                    <DfOption
                      key={t}
                      label={
                        t === "volume"
                          ? "Volume pondéré (défaut)"
                          : t === "tendance"
                            ? "Ce qui monte d'abord"
                            : "Alphabétique"
                      }
                      selected={filtres.tri === t}
                      onClick={() => {
                        setFiltres({ ...filtres, tri: t });
                        close();
                      }}
                    />
                  ))}
                </>
              )}
            </DfDropdown>

            {vue === "grille" && (
              <DfDropdown
                label="Affichage"
                value={`${filtres.colonnes === 0 ? "tous" : filtres.colonnes} métiers`}
                applied={
                  filtres.colonnes !== FILTRES_DEFAUT.colonnes ||
                  filtres.lignes !== FILTRES_DEFAUT.lignes ||
                  filtres.seuil > 0
                }
                width={264}
              >
                {() => (
                  <>
                    <div className="df-grp">Colonnes (métiers)</div>
                    {[12, 25, 0].map((n) => (
                      <DfOption
                        key={`c${n}`}
                        label={n === 0 ? `Tous (${grille.romes.length})` : `Top ${n}`}
                        selected={filtres.colonnes === n}
                        onClick={() => setFiltres({ ...filtres, colonnes: n })}
                      />
                    ))}
                    <div className="df-grp">Lignes (communes)</div>
                    {[25, 50, 0].map((n) => (
                      <DfOption
                        key={`l${n}`}
                        label={n === 0 ? `Toutes (${grille.communes.length})` : `Top ${n}`}
                        selected={filtres.lignes === n}
                        onClick={() => setFiltres({ ...filtres, lignes: n })}
                      />
                    ))}
                    <DfRange
                      value={filtres.seuil}
                      min={0}
                      max={10}
                      legend={
                        filtres.seuil === 0
                          ? "Tous les métiers, même à une mission"
                          : `Métiers d'au moins ${filtres.seuil} mission${filtres.seuil > 1 ? "s" : ""}`
                      }
                      onChange={(seuil) => setFiltres({ ...filtres, seuil })}
                    />
                  </>
                )}
              </DfDropdown>
            )}

            {romeCibles.length > 0 && (
              <DfToggle
                label="Mes métiers"
                on={filtres.mesMetiers}
                onChange={(mesMetiers) => setFiltres({ ...filtres, mesMetiers })}
                title="Ne garder que les métiers que votre agence place"
              />
            )}

            {actifs && <DfClearAll onClear={() => setFiltres({ ...FILTRES_DEFAUT })} />}
          </>
        }
      />

      <PageBody>
        <div className="cv-wrap">
          <p className="pl-note">
            <span>
              <b>Ces missions ne scorent personne.</b> Elles disent où les concurrents placent,
              métier par métier : l’intensité décroît sur {Math.round(demiVie)} jours, une case vide
              sur un métier que vous placez est un angle mort du bassin. Cliquez n’importe quel
              chiffre — case, commune, métier, enseigne — pour voir qui met, et depuis quand.
              {masques > 0 && ` ${masques} métier${masques > 1 ? "s" : ""} hors affichage.`}
              {!tendances &&
                " Tendances masquées sur cette fenêtre : l’historique collecté n’y est pas assez profond (les offres closes disparaissent de la source)."}
              {tronque && " Volume plafonné : les missions les plus récentes seulement."}
            </span>
          </p>

          <div className="cv-cols" data-detail={selection ? true : undefined}>
            {vue === "grille" && (
              <GrilleCouverture
                grille={grille}
                communes={communesAffichees}
                romes={romesAffiches}
                libelle={libelle}
                romeCibles={cibles}
                tendances={tendances}
                selection={selection}
                onSelection={choisir}
              />
            )}
            {vue === "enseignes" && (
              <VueEnseignes
                enseignes={enseignes}
                libelle={libelle}
                tendances={tendances}
                enseigneAgence={enseigneAgence}
                selection={selection}
                onSelection={choisir}
              />
            )}
            {vue === "opportunites" && (
              <VueOpportunites
                opportunites={opportunites}
                sansEcho={sansEcho}
                libelle={libelle}
                tendances={tendances}
                aDesCibles={romeCibles.length > 0}
                connaitNotreAgence={enseigneAgence != null}
                selection={selection}
                onSelection={choisir}
              />
            )}

            <aside className="cv-aside" data-detail={selection ? true : undefined}>
              {selection ? (
                <Panneau
                  selection={selection}
                  missions={retenues}
                  libelle={libelle}
                  fenetre={filtres.fenetre}
                  now={now}
                  tendances={tendances}
                  retour={
                    historique.length > 0
                      ? { label: etiquette(historique[historique.length - 1], libelle), onClick: revenir }
                      : null
                  }
                  onNaviguer={naviguer}
                  onFermer={() => choisir(null)}
                />
              ) : (
                <ResumeBassin
                  missions={retenues}
                  grille={grille}
                  enseignes={enseignes}
                  enseigneAgence={enseigneAgence}
                  libelle={libelle}
                  fenetre={filtres.fenetre}
                  now={now}
                  onSelection={choisir}
                />
              )}
            </aside>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function etiquette(sel: SelectionCouverture, libelle: (rome: string) => string): string {
  switch (sel.kind) {
    case "cellule":
      return `${sel.commune} · ${libelle(sel.rome)}`;
    case "commune":
      return sel.commune;
    case "metier":
      return libelle(sel.rome);
    case "enseigne":
      return sel.nom;
  }
}

/** Ce que veulent dire les teintes et les pastilles, à demeure dans le chrome. */
function Legende() {
  return (
    <span className="cv-legende">
      <span className="ech" aria-hidden />
      <span className="lb">intensité</span>
      <span className="pts">
        <i className="cv-dot" data-f="vif" aria-hidden /> 7 j
        <i className="cv-dot" data-f="tiede" aria-hidden /> 30 j
        <i className="cv-dot" data-f="eteint" aria-hidden /> +
      </span>
    </span>
  );
}
