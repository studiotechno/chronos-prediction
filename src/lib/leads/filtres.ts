/* ── Filtres de la liste des leads (côté client) ─────────────────────
   La page charge les leads du bassin une fois, le filtrage est immédiat :
   à l'échelle d'un bassin d'agence (quelques centaines de lignes), un
   aller-retour serveur par clic de filtre ne se justifie pas. */

import type { LeadListe } from "@/lib/queries";

export interface FiltresLeadsUI {
  /** Recherche libre : raison sociale, commune, SIRET. */
  q: string;
  /** Divisions NAF (2 chiffres) retenues ; vide = toutes. */
  naf: string[];
  /** Types de signaux exigés (au moins un présent) ; vide = tous. */
  types: string[];
  /** Statuts commerciaux retenus ; vide = tous. */
  statuts: string[];
  /** Score final minimum. */
  smin: number;
  /** Distance maximale du besoin à l'agence (lieu du besoin, à défaut l'établissement), en km ; 0 = pas de limite. */
  dmax: number;
  /** Afficher aussi les leads en nurturing (hors flux principal). */
  nurturing: boolean;
}

export const FILTRES_DEFAUT: FiltresLeadsUI = {
  q: "",
  naf: [],
  types: [],
  statuts: [],
  smin: 0,
  dmax: 0,
  nurturing: false,
};

export const CLE_FILTRES = "chronos.leads.filtres";

/** Filtres relus depuis leur forme sérialisée (localStorage). */
export function parseFiltres(brut: string): FiltresLeadsUI {
  if (!brut) return { ...FILTRES_DEFAUT };
  try {
    const lu = JSON.parse(brut) as Partial<FiltresLeadsUI>;
    return {
      ...FILTRES_DEFAUT,
      ...lu,
      // Les tableaux peuvent venir d'une version antérieure du format.
      naf: Array.isArray(lu.naf) ? lu.naf : [],
      types: Array.isArray(lu.types) ? lu.types : [],
      statuts: Array.isArray(lu.statuts) ? lu.statuts : [],
    };
  } catch {
    return { ...FILTRES_DEFAUT };
  }
}

export function serialiserFiltres(f: FiltresLeadsUI): string {
  return JSON.stringify(f);
}

export function filtresActifs(f: FiltresLeadsUI): boolean {
  return (
    f.q.trim() !== "" ||
    f.naf.length > 0 ||
    f.types.length > 0 ||
    f.statuts.length > 0 ||
    f.smin > 0 ||
    f.dmax > 0
  );
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function divisionNaf(naf: string): string {
  return naf.replace(/[^0-9]/g, "").slice(0, 2);
}

export function appliquerFiltres(leads: LeadListe[], f: FiltresLeadsUI): LeadListe[] {
  const q = normalise(f.q.trim());
  return leads.filter((l) => {
    if (!f.nurturing && l.segment !== "chaud") return false;
    if (f.naf.length > 0 && !f.naf.includes(divisionNaf(l.naf))) return false;
    if (f.types.length > 0 && !l.topSignals.some((s) => f.types.includes(s.type))) return false;
    if (f.statuts.length > 0 && !f.statuts.includes(l.statut)) return false;
    if (f.smin > 0 && l.scoreFinal < f.smin) return false;
    if (f.dmax > 0 && (l.distanceKm == null || l.distanceKm > f.dmax)) return false;
    if (q) {
      const foin = normalise(
        `${l.denomination} ${l.commune ?? ""} ${l.siret} ${l.raisonFr} ${l.propositionFr ?? ""} ${l.lieuBesoinFr ?? ""}`,
      );
      if (!foin.includes(q)) return false;
    }
    return true;
  });
}

/** Effectifs par valeur de facette, calculés sur le jeu complet. */
export function compterFacettes(leads: LeadListe[]) {
  const naf = new Map<string, number>();
  const types = new Map<string, number>();
  const statuts = new Map<string, number>();
  for (const l of leads) {
    const div = divisionNaf(l.naf);
    naf.set(div, (naf.get(div) ?? 0) + 1);
    statuts.set(l.statut, (statuts.get(l.statut) ?? 0) + 1);
    for (const t of new Set(l.topSignals.map((s) => s.type))) {
      types.set(t, (types.get(t) ?? 0) + 1);
    }
  }
  return { naf, types, statuts };
}

export const STATUT_LABELS: Record<string, string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  qualifie: "Qualifié",
  gagne: "Gagné",
  perdu: "Perdu",
};
