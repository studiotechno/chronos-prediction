"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { IconCheck, IconRecherche } from "@/components/shell/icons";
import { chercherCommunes, type Commune } from "@/lib/geo/communes";

/* ── Choix de la zone de prospection ─────────────────────────────────
   Une agence ne prospecte pas « la France » : elle prospecte une commune
   d'ancrage et ce qu'elle peut desservir autour. Ces trois réglages
   décident de tout l'outil — la distance entre dans le score Strate, les
   secteurs filtrent le rapprochement des offres, les métiers pondèrent le
   Sismo. D'où un écran qui les explique au lieu de les subir. */

const ZoneMap = dynamic(() => import("@/components/onboarding/zone-map").then((m) => m.ZoneMap), {
  ssr: false,
  loading: () => <div className="oz-map oz-map--vide">Chargement de la carte…</div>,
});

export interface ZonePayload {
  commune: string;
  codePostal: string | null;
  departement: string | null;
  lat: number;
  lon: number;
  rayonKm: number;
  nafCibles: string[];
  romeCibles: string[];
  /** Divisions NAF (2 chiffres) ou codes complets exclus du scoring. */
  nafExclus: string[];
}

export interface ZoneInitiale {
  commune: string | null;
  codePostal: string | null;
  departement: string | null;
  lat: number;
  lon: number;
  rayonKm: number;
  nafCibles: string[];
  romeCibles: string[];
  /** null = liste par défaut du moteur (78 agences d'intérim, 84 administration). */
  nafExclus?: string[] | null;
}

/** Exclusions par défaut du moteur — les mêmes que src/lib/scoring/run.ts. */
export const NAF_EXCLUS_DEFAUT = ["78", "84"];

/** « 78, 84 ; 86.10Z » → ["78", "84", "86.10Z"]. */
export function parseExclusions(saisie: string): string[] {
  return [...new Set(saisie.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter((s) => /^\d{2}(\.\d{2}[A-Z]?)?$/.test(s)))];
}

export function ZoneEditor({
  initiale,
  secteurs,
  metiers,
  saveLabel,
  onSave,
}: {
  initiale?: ZoneInitiale;
  /** Divisions NAF avec leur taux de recours à l'intérim (table DARES). */
  secteurs: { code: string; label: string; taux: number }[];
  metiers: { code: string; label: string }[];
  saveLabel: string;
  onSave: (payload: ZonePayload) => Promise<void>;
}) {
  const [commune, setCommune] = useState<Commune | null>(
    initiale?.commune
      ? {
          code: "",
          nom: initiale.commune,
          codePostal: initiale.codePostal,
          departement: initiale.departement,
          departementNom: null,
          population: null,
          lat: initiale.lat,
          lon: initiale.lon,
        }
      : null,
  );
  const [rayon, setRayon] = useState(initiale?.rayonKm ?? 30);
  const [naf, setNaf] = useState<string[]>(initiale?.nafCibles ?? []);
  const [rome, setRome] = useState<string[]>(initiale?.romeCibles ?? []);
  const [exclus, setExclus] = useState<string>((initiale?.nafExclus ?? NAF_EXCLUS_DEFAUT).join(", "));
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function enregistrer() {
    if (!commune) {
      setErreur("Choisissez d’abord la commune où se trouve votre agence.");
      return;
    }
    if (naf.length === 0) {
      setErreur("Retenez au moins un secteur : c’est lui qui décide des offres rapprochées.");
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      await onSave({
        commune: commune.nom,
        codePostal: commune.codePostal,
        departement: commune.departement,
        lat: commune.lat,
        lon: commune.lon,
        rayonKm: rayon,
        nafCibles: naf,
        romeCibles: rome,
        nafExclus: parseExclusions(exclus),
      });
    } catch (e) {
      setEnCours(false);
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible. Réessayez.");
    }
  }

  return (
    <div className="oz">
      <div className="oz-cols">
        <div className="oz-form">
          <ChampCommune commune={commune} onChoisir={setCommune} />

          <div className="oz-bloc">
            <label className="oz-lb" htmlFor="rayon">
              Rayon desservi
              <b>{rayon} km</b>
            </label>
            <input
              id="rayon"
              type="range"
              className="pp-range"
              min={5}
              max={80}
              step={5}
              value={rayon}
              onChange={(e) => setRayon(Number(e.target.value))}
            />
            <p className="oz-aide">
              La distance à l’agence entre dans le score structurel : au-delà du rayon, une
              entreprise reste visible mais son Socle décroît.
            </p>
          </div>

          <div className="oz-bloc">
            <span className="oz-lb">
              Secteurs travaillés
              <b>{naf.length ? `${naf.length} retenus` : "aucun"}</b>
            </span>
            <p className="oz-aide">
              Le pourcentage est le taux de recours à l’intérim du secteur (table DARES) : plus il
              est élevé, plus une offre y vaut un appel.
            </p>
            <div className="oz-chips">
              {secteurs.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="oz-chip"
                  data-on={naf.includes(s.code)}
                  onClick={() =>
                    setNaf(naf.includes(s.code) ? naf.filter((c) => c !== s.code) : [...naf, s.code])
                  }
                >
                  <span className="ck">{naf.includes(s.code) && <IconCheck size={11} />}</span>
                  <span className="lb">{s.label}</span>
                  <span className="tx">{s.taux.toLocaleString("fr-FR")} %</span>
                </button>
              ))}
            </div>
          </div>

          <div className="oz-bloc">
            <span className="oz-lb">
              Métiers placés
              <b>{rome.length ? `${rome.length} retenus` : "aucun"}</b>
            </span>
            <p className="oz-aide">
              Une offre sur un métier hors de cette liste compte beaucoup moins dans le Pouls. Sans
              sélection, tous les métiers pèsent pareil.
            </p>
            <div className="oz-chips oz-chips--compact">
              {metiers.map((m) => (
                <button
                  key={m.code}
                  type="button"
                  className="oz-chip"
                  data-on={rome.includes(m.code)}
                  onClick={() =>
                    setRome(
                      rome.includes(m.code) ? rome.filter((c) => c !== m.code) : [...rome, m.code],
                    )
                  }
                >
                  <span className="ck">{rome.includes(m.code) && <IconCheck size={11} />}</span>
                  <span className="lb">{m.label}</span>
                  <span className="tx">{m.code}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="oz-bloc">
            <label className="oz-lb" htmlFor="exclus">
              Secteurs exclus
              <b>{parseExclusions(exclus).length ? parseExclusions(exclus).join(", ") : "aucun"}</b>
            </label>
            <input
              id="exclus"
              className="oz-input"
              value={exclus}
              onChange={(e) => setExclus(e.target.value)}
              placeholder="78, 84"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="oz-aide">
              Divisions NAF (deux chiffres) ou codes complets qui ne seront jamais scorés, séparés par
              des virgules. Par défaut : 78 (agences d’intérim) et 84 (administration publique). Une agence
              qui ne place pas dans le soin ajoutera 86, 87, 88.
            </p>
          </div>
        </div>

        <aside className="oz-apercu">
          {commune ? (
            <>
              <ZoneMap lat={commune.lat} lon={commune.lon} rayonKm={rayon} />
              <div className="oz-recap">
                <b>{commune.nom}</b>
                <span>
                  {[commune.codePostal, commune.departementNom ?? commune.departement]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span>
                  Rayon {rayon} km · {naf.length} secteur{naf.length > 1 ? "s" : ""} ·{" "}
                  {rome.length} métier{rome.length > 1 ? "s" : ""}
                </span>
              </div>
            </>
          ) : (
            <div className="oz-map oz-map--vide">
              La carte s’affiche dès qu’une commune est choisie.
            </div>
          )}
        </aside>
      </div>

      {erreur && <p className="oz-erreur">{erreur}</p>}

      <button type="button" className="oz-cta" onClick={enregistrer} disabled={enCours}>
        {enCours ? "Enregistrement…" : saveLabel}
      </button>
    </div>
  );
}

/* ── Recherche de commune ─────────────────────────────────────────── */
function ChampCommune({
  commune,
  onChoisir,
}: {
  commune: Commune | null;
  onChoisir: (c: Commune) => void;
}) {
  const [saisie, setSaisie] = useState("");
  const [resultats, setResultats] = useState<Commune[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const boite = useRef<HTMLDivElement>(null);

  // Recherche différée : on ne bombarde pas l'API à chaque frappe, et la
  // requête précédente est annulée dès que la saisie change.
  useEffect(() => {
    const q = saisie.trim();
    if (q.length < 2) {
      setResultats([]);
      return;
    }
    const controleur = new AbortController();
    const minuteur = setTimeout(() => {
      chercherCommunes(q, controleur.signal)
        .then((liste) => {
          setResultats(liste);
          setOuvert(true);
          setErreur(null);
        })
        .catch((e: unknown) => {
          if (controleur.signal.aborted) return;
          setErreur(e instanceof Error ? e.message : "Recherche indisponible");
        });
    }, 220);
    return () => {
      controleur.abort();
      clearTimeout(minuteur);
    };
  }, [saisie]);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!ouvert) return;
    function onDown(e: MouseEvent) {
      if (!boite.current?.contains(e.target as Node)) setOuvert(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ouvert]);

  return (
    <div className="oz-bloc" ref={boite}>
      <label className="oz-lb" htmlFor="commune">
        Commune de l’agence
        {commune && <b>{commune.nom}</b>}
      </label>
      <div className="oz-search">
        <IconRecherche size={15} />
        <input
          id="commune"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onFocus={() => resultats.length > 0 && setOuvert(true)}
          placeholder={commune ? commune.nom : "Nom de commune ou code postal"}
          autoComplete="off"
        />
      </div>
      {ouvert && resultats.length > 0 && (
        <div className="oz-pop">
          {resultats.map((c) => (
            <button
              key={c.code}
              type="button"
              className="oz-pop-item"
              onClick={() => {
                onChoisir(c);
                setSaisie("");
                setOuvert(false);
              }}
            >
              <span className="a">{c.nom}</span>
              <span className="b">
                {[c.codePostal, c.departementNom].filter(Boolean).join(" · ")}
                {c.population ? ` · ${c.population.toLocaleString("fr-FR")} hab.` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
      {erreur && <p className="oz-aide oz-aide--erreur">{erreur}</p>}
    </div>
  );
}
