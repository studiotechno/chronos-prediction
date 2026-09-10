"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef } from "react";
import { PageBody, PageChrome } from "@/components/shell/page-chrome";
import { useSearchShortcut } from "@/components/shell/app-shell";
import {
  DfClearAll,
  DfDropdown,
  DfOption,
  DfPopFooter,
  DfRange,
  DfSeparator,
} from "@/components/shell/filters";
import {
  IconActualites,
  IconAlerte,
  IconBatiment,
  IconCalendrier,
  IconCapital,
  IconFleche,
  IconLienExterne,
  IconMarche,
  IconRecherche,
  IconTendance,
} from "@/components/shell/icons";
import { PuceSignal, familleSignal } from "@/components/signaux";
import { useStoredString } from "@/lib/client-state";
import {
  appliquerFiltres,
  CLE_FILTRES,
  compterTypes,
  FENETRES,
  FILTRES_DEFAUT,
  filtresActifs,
  grouperParRubrique,
  joursRestants,
  parseFiltres,
  RUBRIQUES,
  serialiserFiltres,
  urgenceLisible,
  type Cadrage,
  type FiltresActualitesUI,
} from "@/lib/actualites/filtres";
import { dateCourte, dateRelative, distanceLisible } from "@/lib/format";
import { montantFr } from "@/lib/scoring/raison";
import { signalTypeLabel } from "@/lib/scoring/labels";
import type { Actualite, RubriqueActualite } from "@/lib/queries";

/* ── Fil d'actualités du bassin ──────────────────────────────────────
   Ce que le commercial doit savoir avant d'appeler, sans passer par le
   score : qui a gagné un marché public, quels appels d'offres ferment
   bientôt, et ce qui a bougé dans la vie des entreprises autour de lui.
   Trois rubriques, un seul fil ; le cadrage choisit laquelle occupe
   l'écran, les filtres valent pour les trois. */

/** En vue « tout », chaque rubrique montre sa tête de liste, pas tout son stock. */
const APERCU = 6;

export function ActualitesVue({ actualites }: { actualites: Actualite[] }) {
  const [filtresBruts, setFiltresBruts] = useStoredString(CLE_FILTRES, "");
  const filtres = useMemo(() => parseFiltres(filtresBruts), [filtresBruts]);
  const champRecherche = useRef<HTMLInputElement>(null);

  useSearchShortcut(useCallback(() => champRecherche.current?.focus(), []));

  function setFiltres(next: FiltresActualitesUI) {
    setFiltresBruts(serialiserFiltres(next));
  }

  const retenues = useMemo(() => appliquerFiltres(actualites, filtres), [actualites, filtres]);
  const groupes = useMemo(() => grouperParRubrique(retenues), [retenues]);
  const facettes = useMemo(() => compterTypes(actualites), [actualites]);
  const actifs = filtresActifs(filtres);

  const typesPresents = useMemo(
    () => [...facettes.entries()].sort((a, b) => b[1] - a[1]),
    [facettes],
  );

  const fenetre = FENETRES.find((f) => f.jours === filtres.jours) ?? FENETRES[1];
  const rubriquesAffichees = RUBRIQUES.filter(
    (r) => filtres.cadrage === "tout" || filtres.cadrage === r.id,
  );

  /* Ce que la période retenue pèse, en une ligne : le montant des marchés
     gagnés autour de soi est le chiffre que personne d'autre ne donne. */
  const montantAttribue = groupes.attribue.reduce((n, a) => n + (a.montant ?? 0), 0);
  const compteur = [
    `${groupes.attribue.length.toLocaleString("fr-FR")} attribué${groupes.attribue.length > 1 ? "s" : ""}`,
    `${groupes.a_venir.length.toLocaleString("fr-FR")} à venir`,
    `${groupes.vie.length.toLocaleString("fr-FR")} sur la vie des entreprises`,
  ].join(" · ");

  return (
    <>
      <PageChrome
        icon={<IconActualites size={18} />}
        title="Actualités"
        count={compteur}
        filters={
          <>
            <span className="df-vsw ac-cadrage">
              {(
                [
                  ["tout", "Tout"],
                  ["attribue", "Attribués"],
                  ["a_venir", "À venir"],
                  ["vie", "Vie des entreprises"],
                ] as [Cadrage, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={filtres.cadrage === id ? "on" : undefined}
                  aria-pressed={filtres.cadrage === id}
                  onClick={() => setFiltres({ ...filtres, cadrage: id })}
                >
                  {label}
                </button>
              ))}
            </span>
            <DfSeparator />

            <span className="df-search">
              <IconRecherche size={14} />
              <input
                ref={champRecherche}
                value={filtres.q}
                onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
                placeholder="Objet, acheteur, entreprise, métier…"
                aria-label="Rechercher dans les actualités"
              />
            </span>

            <DfDropdown
              label="Période"
              value={fenetre.label.toLowerCase()}
              applied={filtres.jours !== FILTRES_DEFAUT.jours}
              width={230}
            >
              {(close) => (
                <>
                  {FENETRES.map((f) => (
                    <DfOption
                      key={f.jours}
                      label={f.label}
                      selected={filtres.jours === f.jours}
                      onClick={() => {
                        setFiltres({ ...filtres, jours: f.jours });
                        close();
                      }}
                    />
                  ))}
                </>
              )}
            </DfDropdown>

            <DfDropdown
              label="Nature"
              value={
                filtres.types.length === 0
                  ? "toutes"
                  : filtres.types.length === 1
                    ? signalTypeLabel(filtres.types[0])
                    : `${filtres.types.length} natures`
              }
              applied={filtres.types.length > 0}
              badge={filtres.types.length}
              width={286}
            >
              {(close) => (
                <>
                  {typesPresents.map(([type, n]) => (
                    <DfOption
                      key={type}
                      multi
                      label={signalTypeLabel(type)}
                      count={n}
                      selected={filtres.types.includes(type)}
                      onClick={() =>
                        setFiltres({
                          ...filtres,
                          types: filtres.types.includes(type)
                            ? filtres.types.filter((t) => t !== type)
                            : [...filtres.types, type],
                        })
                      }
                    />
                  ))}
                  <DfPopFooter onClear={() => setFiltres({ ...filtres, types: [] })} onApply={close} />
                </>
              )}
            </DfDropdown>

            <DfDropdown
              label="Distance"
              value={filtres.dmax === 0 ? "illimitée" : `≤ ${filtres.dmax} km`}
              applied={filtres.dmax > 0}
              width={252}
            >
              {() => (
                <DfRange
                  value={filtres.dmax}
                  min={0}
                  max={150}
                  step={10}
                  legend={
                    filtres.dmax === 0 ? (
                      <>Tout ce qui a été ingéré sur le bassin</>
                    ) : (
                      <>
                        Établissement à moins de <b>{filtres.dmax} km</b> de l’agence — les avis dont le
                        titulaire n’est pas identifié restent affichés
                      </>
                    )
                  }
                  onChange={(v) => setFiltres({ ...filtres, dmax: v })}
                />
              )}
            </DfDropdown>

            {actifs && (
              <DfClearAll
                onClear={() => setFiltres({ ...FILTRES_DEFAUT, cadrage: filtres.cadrage })}
              />
            )}
          </>
        }
        filtersRight={
          montantAttribue > 0 ? (
            <span className="ac-total">
              {montantFr(montantAttribue)} attribués sur la période
            </span>
          ) : undefined
        }
      />

      <PageBody>
        <div className="pl-wrap">
          {retenues.length === 0 ? (
            <div className="pl-empty">
              <span className="ico">
                <IconActualites size={22} />
              </span>
              <h2>Rien à signaler</h2>
              <p>
                {actualites.length === 0
                  ? "Aucun marché public, appel d'offres ni événement de registre n'a encore été ingéré. Lancez « npm run ingest:all » pour peupler ce fil."
                  : "Aucune actualité ne correspond aux filtres actifs — élargissez la période ou la nature."}
              </p>
            </div>
          ) : (
            rubriquesAffichees.map((r) => {
              const liste = groupes[r.id];
              const apercu = filtres.cadrage === "tout" ? liste.slice(0, APERCU) : liste;
              const reste = liste.length - apercu.length;

              return (
                <section key={r.id}>
                  <header className="ac-sec">
                    <span className="eb">{r.eyebrow}</span>
                    <h2>{r.titre}</h2>
                    <span className="nb">{liste.length.toLocaleString("fr-FR")}</span>
                    <span className="no">{r.note}</span>
                  </header>

                  {liste.length === 0 ? (
                    <p className="ac-vide">Rien sur cette rubrique dans la période retenue.</p>
                  ) : (
                    <ul className="ac-liste chr-cascade">
                      {apercu.map((a, i) => (
                        <Entree
                          key={a.id}
                          actu={a}
                          rubrique={r.id}
                          rang={i}
                          montrerType={new Set(liste.map((x) => x.type)).size > 1}
                        />
                      ))}
                    </ul>
                  )}

                  {reste > 0 && (
                    <button
                      type="button"
                      className="ac-plus"
                      onClick={() => setFiltres({ ...filtres, cadrage: r.id })}
                    >
                      Voir les {reste.toLocaleString("fr-FR")} autres
                      <IconFleche size={13} />
                    </button>
                  )}
                </section>
              );
            })
          )}
        </div>
      </PageBody>
    </>
  );
}

/* ── Une ligne du registre ───────────────────────────────────────────
   Trois colonnes, toujours les mêmes : QUAND à gauche en chiffres, QUOI
   au milieu, COMBIEN à droite. La date de gauche est celle qui commande
   la ligne — la clôture pour une consultation, l'événement sinon : c'est
   la seule qui dise quoi faire aujourd'hui. Le filet de gauche porte la
   famille du signal : ambre ce qui bouge, acier ce qui installe, rouge ce
   qui alerte. */
/** Une icône par nature d'événement : la vignette se lit avant le texte. */
function IconeNature({ type }: { type: string }) {
  switch (type) {
    case "MARCHE_ATTRIBUE":
      return <IconMarche size={17} />;
    case "AO_OUVERT":
      return <IconCalendrier size={17} />;
    case "BODACC_RISQUE":
    case "CA_BAISSE":
    case "ACCORD_RESTRUCTURATION":
      return <IconAlerte size={17} />;
    case "EFFECTIF_UP":
    case "CA_CROISSANCE":
      return <IconTendance size={17} />;
    case "BODACC_CAPITAL":
      return <IconCapital size={17} />;
    default:
      return <IconBatiment size={17} />;
  }
}

function Entree({
  actu,
  rubrique,
  rang,
  montrerType,
}: {
  actu: Actualite;
  rubrique: RubriqueActualite;
  /** Rang dans la liste : décale l'apparition en cascade. */
  rang: number;
  /* Une rubrique où toutes les lignes portent la même nature n'a pas besoin
     de la répéter à chaque ligne : le filet de gauche la dit déjà, et six
     fois « Marché public attribué » n'apprend rien à personne. */
  montrerType: boolean;
}) {
  const echeance = rubrique === "a_venir" ? actu.dateLimite : null;
  const restant = echeance ? joursRestants(echeance) : null;
  const pilote = echeance ?? actu.date;
  /* Deux formes de ligne, selon ce dont elle parle. Une ligne de commande
     publique a pour sujet un MARCHÉ : son objet fait le titre, l'entreprise
     suit. Une ligne de vie d'entreprise a pour sujet l'ENTREPRISE : c'est son
     nom qui titre, et l'événement devient le descriptif. Titrer les deux de la
     même façon donnait « Augmentation de capital » six fois d'affilée. */
  const nomme = actu.denomination ?? actu.nomSource;

  return (
    <li
      className="ac-row"
      data-famille={familleSignal(actu.type)}
      style={{ "--i": rang } as React.CSSProperties}
    >
      <span className="ac-tuile" aria-hidden>
        <IconeNature type={actu.type} />
      </span>

      <div className="ac-body">
        <p className="ac-titre">
          {actu.objet ?? (nomme ? <Entreprise actu={actu} /> : actu.resume)}
        </p>

        <div className="ac-meta">
          {montrerType && <PuceSignal type={actu.type} />}
          {actu.objet ? <Entreprise actu={actu} /> : <span>{actu.resume}</span>}
          {actu.acheteur && (
            <span>
              Acheteur : <b>{actu.acheteur}</b>
            </span>
          )}
          {actu.dureeMois != null && actu.dureeMois > 0 && <span>{actu.dureeMois} mois</span>}
          {actu.procedure && <span>{actu.procedure}</span>}
          {actu.tribunal && <span>{actu.tribunal}</span>}
          {actu.urlAvis && (
            <a className="ac-lien" href={actu.urlAvis} target="_blank" rel="noreferrer noopener">
              <IconLienExterne size={12} />
              Avis publié
            </a>
          )}
        </div>

        {actu.metiers.length > 0 && (
          <div className="ac-metiers">
            <span className="lb">À placer</span>
            {actu.metiers.slice(0, 4).map((m) => (
              <span className="mt" key={m}>
                {m}
              </span>
            ))}
            {actu.metiers.length > 4 && <span className="pl">+{actu.metiers.length - 4}</span>}
          </div>
        )}
      </div>

      <div className="ac-side">
        {actu.montant != null && actu.montant > 0 && (
          <span className="ac-montant">{montantFr(actu.montant)}</span>
        )}
        {echeance && restant != null ? (
          <span
            className="ac-echeance"
            data-urgent={restant >= 0 && restant <= 7 ? "" : undefined}
            data-clos={restant < 0 ? "" : undefined}
          >
            {urgenceLisible(echeance)}
          </span>
        ) : null}
        <span className="ac-quand">
          <b>{dateCourte(pilote)}</b>
          {!echeance && <em>{dateRelative(actu.date)}</em>}
        </span>
        {actu.demo && <span className="ac-demo">fixture</span>}
      </div>
    </li>
  );
}

/** L'entreprise concernée : sa fiche si elle en a une, son nom brut sinon. */
function Entreprise({ actu }: { actu: Actualite }) {
  if (actu.siret && actu.denomination) {
    return (
      <Link className="ac-etab" href={`/lead/${actu.siret}`}>
        <b>{actu.denomination}</b>
        {actu.commune && <span className="cm"> · {actu.commune}</span>}
        {actu.distanceKm != null && <span className="cm"> · {distanceLisible(actu.distanceKm)}</span>}
        {actu.scoreFinal != null && <span className="sc">{Math.round(actu.scoreFinal)}</span>}
      </Link>
    );
  }

  if (actu.nomSource) {
    return (
      <span className="ac-etab" data-brut="">
        <b>{actu.nomSource}</b>
        {actu.enResolution && (
          <Link className="cm" href="/resolution">
            à rapprocher
          </Link>
        )}
      </span>
    );
  }

  return null;
}
