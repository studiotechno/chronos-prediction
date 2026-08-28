/* ── Filtres de la couverture (côté client) ──────────────────────────
   Mêmes principes que les filtres de leads : un état sérialisé dans
   localStorage, appliqué en mémoire sur le jeu chargé une fois. On
   revient le lendemain sur sa fenêtre et ses enseignes, pas sur les
   réglages de tout le monde. */

import { romeLabel } from "@/lib/reference/rome";
import { ageJours, type MissionCouverture, type TriCouverture } from "./agregat";

export type VueCouverture = "grille" | "enseignes" | "opportunites";

export interface FiltresCouverture {
  /** Recherche libre : commune, métier, enseigne, intitulé. */
  q: string;
  /** Profondeur d'historique retenue, en jours. */
  fenetre: number;
  /** Enseignes retenues ; vide = toutes. */
  enseignes: string[];
  /** Ne garder que les métiers que l'agence place (romeCibles). */
  mesMetiers: boolean;
  /** Nombre de colonnes métier affichées ; 0 = toutes. */
  colonnes: number;
  /** Nombre de lignes commune affichées ; 0 = toutes. */
  lignes: number;
  /** Missions minimum pour qu'un métier garde sa colonne. */
  seuil: number;
  tri: TriCouverture;
}

export const FENETRES = [30, 60, 90] as const;

export const FILTRES_DEFAUT: FiltresCouverture = {
  q: "",
  fenetre: 90,
  enseignes: [],
  mesMetiers: false,
  colonnes: 12,
  lignes: 25,
  seuil: 0,
  tri: "volume",
};

export const CLE_FILTRES = "chronos.couverture.filtres";
export const CLE_VUE = "chronos.couverture.vue";

export function parseFiltres(brut: string): FiltresCouverture {
  if (!brut) return { ...FILTRES_DEFAUT };
  try {
    const lu = JSON.parse(brut) as Partial<FiltresCouverture>;
    return {
      ...FILTRES_DEFAUT,
      ...lu,
      enseignes: Array.isArray(lu.enseignes) ? lu.enseignes : [],
    };
  } catch {
    return { ...FILTRES_DEFAUT };
  }
}

export function serialiserFiltres(f: FiltresCouverture): string {
  return JSON.stringify(f);
}

/** Un filtre est « actif » s'il retranche de la vue par défaut. */
export function filtresActifs(f: FiltresCouverture): boolean {
  return (
    f.q.trim() !== "" ||
    f.fenetre !== FILTRES_DEFAUT.fenetre ||
    f.enseignes.length > 0 ||
    f.mesMetiers ||
    f.seuil > 0
  );
}

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Filtrage des missions. Le découpage des colonnes et des lignes (`colonnes`,
 * `lignes`, `seuil`) n'intervient pas ici : il porte sur la grille construite,
 * pas sur les missions — sinon les totaux mentiraient sur ce qui a été écarté.
 */
export function appliquerFiltres(
  missions: MissionCouverture[],
  f: FiltresCouverture,
  { now, romeCibles, libelles }: { now: number; romeCibles: string[]; libelles: Record<string, string> },
): MissionCouverture[] {
  const q = normalise(f.q.trim());
  const enseignes = new Set(f.enseignes);
  const cibles = new Set(romeCibles);
  return missions.filter((m) => {
    if (ageJours(m.date, now) > f.fenetre) return false;
    if (enseignes.size > 0 && !enseignes.has(m.agence)) return false;
    if (f.mesMetiers && !cibles.has(m.rome)) return false;
    if (q) {
      const metier = libelles[m.rome] ?? romeLabel(m.rome);
      if (!normalise(`${m.commune} ${metier} ${m.rome} ${m.agence} ${m.intitule}`).includes(q)) {
        return false;
      }
    }
    return true;
  });
}
