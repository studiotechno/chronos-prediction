"use client";

import dynamic from "next/dynamic";
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
  DfToggle,
  DfViewSwitch,
} from "@/components/shell/filters";
import { IconCarte, IconLeads, IconListe, IconRecherche } from "@/components/shell/icons";
import { LegendeScores } from "@/components/score";
import { LeadsTable } from "@/components/leads/leads-table";
import type { AgenceCarte } from "@/components/leads/leads-map";
import { useStoredString } from "@/lib/client-state";
import {
  appliquerFiltres,
  CLE_FILTRES,
  compterFacettes,
  FILTRES_DEFAUT,
  filtresActifs,
  parseFiltres,
  serialiserFiltres,
  STATUT_LABELS,
  type FiltresLeadsUI,
} from "@/lib/leads/filtres";
import { signalTypeLabel } from "@/lib/scoring/labels";
import { SIGNAL_TYPES } from "@/lib/scoring/weights-defaults";
import type { LeadListe } from "@/lib/queries";

/* ── Écran des leads ─────────────────────────────────────────────────
   L'écran de travail du commercial : la même liste filtrée, lue en
   tableau ou sur la carte. Les filtres vivent dans la bande du chrome et
   sont retenus d'une session à l'autre — on revient le lendemain sur son
   secteur, pas sur celui de tout le monde. */

/** MapLibre est un canvas navigateur : la carte se charge sans SSR. */
const LeadsMap = dynamic(() => import("@/components/leads/leads-map").then((m) => m.LeadsMap), {
  ssr: false,
  loading: () => (
    <div className="grid flex-1 place-items-center bg-s2">
      <span className="pp-meta">Chargement de la carte…</span>
    </div>
  ),
});

type Mode = "liste" | "carte";
const CLE_MODE = "chronos.leads.mode";

export function LeadsView({
  leads,
  agence,
  nafDivisions,
}: {
  leads: LeadListe[];
  agence: AgenceCarte & { commune: string | null };
  /** Divisions NAF présentes dans le jeu, avec leur libellé DARES. */
  nafDivisions: { code: string; label: string }[];
}) {
  /* Mode d'affichage et filtres vivent dans localStorage, lus par un hook qui
     rend le défaut au serveur : l'état est donc directement la valeur
     persistée, sans copie dans un useState à resynchroniser. */
  const [modeBrut, setModeBrut] = useStoredString(CLE_MODE, "liste");
  const mode: Mode = modeBrut === "carte" ? "carte" : "liste";
  const [filtresBruts, setFiltresBruts] = useStoredString(CLE_FILTRES, "");
  const filtres = useMemo(() => parseFiltres(filtresBruts), [filtresBruts]);
  const champRecherche = useRef<HTMLInputElement>(null);

  // ⌘K revient à la recherche tant que cet écran est monté.
  useSearchShortcut(useCallback(() => champRecherche.current?.focus(), []));

  function setMode(next: Mode) {
    setModeBrut(next);
  }

  function setFiltres(next: FiltresLeadsUI) {
    setFiltresBruts(serialiserFiltres(next));
  }

  const facettes = useMemo(() => compterFacettes(leads), [leads]);
  const filtrees = useMemo(() => appliquerFiltres(leads, filtres), [leads, filtres]);
  const actifs = filtresActifs(filtres);

  const chauds = leads.filter((l) => l.segment === "chaud").length;
  const affichesChauds = filtrees.filter((l) => l.segment === "chaud").length;

  /* Les types dans l'ordre du registre du moteur (offres, commande publique,
     registre, accords, urbanisme), avec leur effectif ; un type absent du jeu
     n'apparaît que s'il est déjà sélectionné, pour pouvoir le désélectionner.
     Les signaux de bassin (missions concurrentes, appels d'offres) ne sont
     jamais portés par un lead : ils ne figurent pas dans ce filtre. */
  const typesPresents = useMemo(() => {
    const connus = new Set<string>(SIGNAL_TYPES);
    const liste: [string, number][] = SIGNAL_TYPES.filter(
      (t) => t !== "MISSION_CONCURRENT" && t !== "AO_OUVERT",
    )
      .map((t): [string, number] => [t, facettes.types.get(t) ?? 0])
      .filter(([t, n]) => n > 0 || filtres.types.includes(t));
    for (const [t, n] of facettes.types) if (!connus.has(t)) liste.push([t, n]);
    return liste;
  }, [facettes, filtres.types]);
  const statutsPresents = useMemo(
    () => [...facettes.statuts.entries()].sort((a, b) => b[1] - a[1]),
    [facettes],
  );

  const compteur = actifs
    ? `${filtrees.length.toLocaleString("fr-FR")} sur ${leads.length.toLocaleString("fr-FR")} leads`
    : `${chauds.toLocaleString("fr-FR")} lead${chauds > 1 ? "s" : ""} chaud${chauds > 1 ? "s" : ""} · ${(
        leads.length - chauds
      ).toLocaleString("fr-FR")} tièdes`;

  const videHint =
    leads.length === 0
      ? "Aucun lead calculé pour l'instant. Lancez une ingestion puis « npm run score » pour peupler cette liste."
      : filtrees.length === 0
        ? "Aucun lead ne correspond aux filtres actifs — élargissez la sélection, ou affichez les tièdes."
        : !filtres.nurturing && affichesChauds === 0
          ? "Aucun déclencheur récent dans la zone. Les tièdes, eux, ne manquent pas : activez-les pour voir les entreprises à préparer."
          : "";

  return (
    <>
      <PageChrome
        icon={<IconLeads size={18} />}
        title="Leads chauds"
        count={compteur}
        actions={<LegendeScores />}
        filters={
          <>
            <DfViewSwitch
              value={mode}
              onChange={setMode}
              options={[
                { id: "liste", title: "Liste", icon: <IconListe /> },
                { id: "carte", title: "Carte", icon: <IconCarte /> },
              ]}
            />
            <DfSeparator />

            <span className="df-search">
              <IconRecherche size={14} />
              <input
                ref={champRecherche}
                value={filtres.q}
                onChange={(e) => setFiltres({ ...filtres, q: e.target.value })}
                placeholder="Entreprise, commune, SIRET…"
                aria-label="Rechercher un lead"
              />
            </span>

            <DfDropdown
              label="Secteur"
              value={
                filtres.naf.length === 0
                  ? "tous"
                  : filtres.naf.length === 1
                    ? (nafDivisions.find((d) => d.code === filtres.naf[0])?.label ?? filtres.naf[0])
                    : `${filtres.naf.length} secteurs`
              }
              applied={filtres.naf.length > 0}
              badge={filtres.naf.length}
              width={300}
            >
              {(close) => (
                <>
                  {nafDivisions.map((d) => (
                    <DfOption
                      key={d.code}
                      multi
                      label={d.label}
                      count={facettes.naf.get(d.code) ?? 0}
                      selected={filtres.naf.includes(d.code)}
                      onClick={() =>
                        setFiltres({
                          ...filtres,
                          naf: filtres.naf.includes(d.code)
                            ? filtres.naf.filter((c) => c !== d.code)
                            : [...filtres.naf, d.code],
                        })
                      }
                    />
                  ))}
                  <DfPopFooter onClear={() => setFiltres({ ...filtres, naf: [] })} onApply={close} />
                </>
              )}
            </DfDropdown>

            <DfDropdown
              label="Signal"
              value={
                filtres.types.length === 0
                  ? "tous"
                  : filtres.types.length === 1
                    ? signalTypeLabel(filtres.types[0])
                    : `${filtres.types.length} types`
              }
              applied={filtres.types.length > 0}
              badge={filtres.types.length}
              width={280}
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
              label="Score min"
              value={filtres.smin === 0 ? "aucun" : String(filtres.smin)}
              applied={filtres.smin > 0}
              width={244}
            >
              {() => (
                <DfRange
                  value={filtres.smin}
                  min={0}
                  max={90}
                  step={5}
                  legend={
                    <>
                      Score final ≥ <b>{filtres.smin}</b>
                    </>
                  }
                  onChange={(v) => setFiltres({ ...filtres, smin: v })}
                />
              )}
            </DfDropdown>

            <DfDropdown
              label="Distance"
              value={filtres.dmax === 0 ? "toute la zone" : `≤ ${filtres.dmax} km`}
              applied={filtres.dmax > 0}
              width={244}
            >
              {() => (
                <DfRange
                  value={filtres.dmax}
                  min={0}
                  max={Math.max(60, Math.ceil(agence.rayonKm))}
                  step={5}
                  legend={
                    filtres.dmax === 0 ? (
                      <>Toute la zone</>
                    ) : (
                      <>
                        Besoin à moins de <b>{filtres.dmax} km</b> de l’agence (chantier ou lieu de travail,
                        à défaut l’établissement)
                      </>
                    )
                  }
                  onChange={(v) => setFiltres({ ...filtres, dmax: v })}
                />
              )}
            </DfDropdown>

            <DfDropdown
              label="Statut"
              value={filtres.statuts.length === 0 ? "tous" : `${filtres.statuts.length} retenus`}
              applied={filtres.statuts.length > 0}
              badge={filtres.statuts.length}
            >
              {(close) => (
                <>
                  {statutsPresents.map(([statut, n]) => (
                    <DfOption
                      key={statut}
                      multi
                      label={STATUT_LABELS[statut] ?? statut}
                      count={n}
                      selected={filtres.statuts.includes(statut)}
                      onClick={() =>
                        setFiltres({
                          ...filtres,
                          statuts: filtres.statuts.includes(statut)
                            ? filtres.statuts.filter((s) => s !== statut)
                            : [...filtres.statuts, statut],
                        })
                      }
                    />
                  ))}
                  <DfPopFooter
                    onClear={() => setFiltres({ ...filtres, statuts: [] })}
                    onApply={close}
                  />
                </>
              )}
            </DfDropdown>

            <DfSeparator />
            <DfToggle
              label="Tièdes"
              on={filtres.nurturing}
              onChange={(v) => setFiltres({ ...filtres, nurturing: v })}
              title="Afficher aussi les entreprises au bon profil sans déclencheur récent"
            />
          </>
        }
        filtersRight={
          actifs ? <DfClearAll onClear={() => setFiltres({ ...FILTRES_DEFAUT })} /> : undefined
        }
      />

      <PageBody bleed>
        {mode === "carte" ? (
          <LeadsMap leads={filtrees} agence={agence} videHint={videHint || null} />
        ) : (
          <LeadsTable
            leads={filtrees}
            videHint={videHint}
            masques={filtres.nurturing ? 0 : leads.length - chauds}
            onAfficherNurturing={() => setFiltres({ ...filtres, nurturing: true })}
          />
        )}
      </PageBody>
    </>
  );
}
