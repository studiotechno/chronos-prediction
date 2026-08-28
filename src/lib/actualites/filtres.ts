/* ── Filtres du fil d'actualités (côté client) ───────────────────────
   Comme la liste des leads : le bassin tient en mémoire, le filtrage est
   immédiat. La rubrique n'est pas un filtre mais un cadrage — elle décide
   des sections affichées, pas des lignes retenues. */

import type { Actualite, RubriqueActualite } from "@/lib/queries";

export type Cadrage = "tout" | RubriqueActualite;

export interface FiltresActualitesUI {
  /** Rubrique mise en avant ; « tout » empile les trois sections. */
  cadrage: Cadrage;
  /** Recherche libre : objet, acheteur, entreprise, commune, métier. */
  q: string;
  /** Profondeur en jours ; 0 = tout ce que le serveur a servi. */
  jours: number;
  /** Types de signaux retenus ; vide = tous. */
  types: string[];
}

export const FILTRES_DEFAUT: FiltresActualitesUI = {
  cadrage: "tout",
  q: "",
  jours: 90,
  types: [],
};

export const CLE_FILTRES = "chronos.actualites.filtres";

export const FENETRES: { jours: number; label: string }[] = [
  { jours: 30, label: "30 derniers jours" },
  { jours: 90, label: "3 derniers mois" },
  { jours: 180, label: "6 derniers mois" },
  { jours: 0, label: "Tout l'historique" },
];

export const RUBRIQUES: { id: RubriqueActualite; titre: string; eyebrow: string; note: string }[] = [
  {
    id: "attribue",
    titre: "Marchés publics attribués",
    eyebrow: "Commande publique",
    note: "Qui a gagné quoi sur le bassin — un carnet qui se remplit précède les embauches.",
  },
  {
    id: "a_venir",
    titre: "Appels d'offres à venir",
    eyebrow: "À surveiller",
    note: "Consultations en cours, la plus proche de sa clôture en tête — les entreprises qui répondent auront besoin de bras si elles gagnent.",
  },
  {
    id: "vie",
    titre: "Vie des entreprises",
    eyebrow: "Bon à savoir",
    note: "Effectifs, capital, résultats, accords, procédures collectives : ce qui change le contexte d'un appel.",
  },
];

export function parseFiltres(brut: string): FiltresActualitesUI {
  if (!brut) return { ...FILTRES_DEFAUT };
  try {
    const lu = JSON.parse(brut) as Partial<FiltresActualitesUI>;
    return {
      ...FILTRES_DEFAUT,
      ...lu,
      types: Array.isArray(lu.types) ? lu.types : [],
    };
  } catch {
    return { ...FILTRES_DEFAUT };
  }
}

export function serialiserFiltres(f: FiltresActualitesUI): string {
  return JSON.stringify(f);
}

export function filtresActifs(f: FiltresActualitesUI): boolean {
  return f.q.trim() !== "" || f.types.length > 0 || f.jours !== FILTRES_DEFAUT.jours;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function appliquerFiltres(actualites: Actualite[], f: FiltresActualitesUI): Actualite[] {
  const q = normalise(f.q.trim());
  const limite = f.jours > 0 ? Date.now() - f.jours * 86400000 : null;

  return actualites.filter((a) => {
    if (f.types.length > 0 && !f.types.includes(a.type)) return false;
    /* Un appel d'offres se juge sur sa date limite, pas sur sa parution :
       le restreindre à la fenêtre de parution masquerait une consultation
       publiée il y a longtemps mais qui ferme la semaine prochaine. */
    if (limite != null && a.rubrique !== "a_venir" && new Date(a.date).getTime() < limite) return false;
    if (q) {
      const foin = normalise(
        [
          a.objet ?? "",
          a.resume,
          a.acheteur ?? "",
          a.denomination ?? "",
          a.titulaireBrut ?? "",
          a.commune ?? "",
          a.siret ?? "",
          a.metiers.join(" "),
        ].join(" "),
      );
      if (!foin.includes(q)) return false;
    }
    return true;
  });
}

/** Les trois rubriques, chacune triée selon ce qui presse : la date limite pour un appel d'offres, la date de l'événement sinon. */
export function grouperParRubrique(actualites: Actualite[]): Record<RubriqueActualite, Actualite[]> {
  const groupes: Record<RubriqueActualite, Actualite[]> = { attribue: [], a_venir: [], vie: [] };
  for (const a of actualites) groupes[a.rubrique].push(a);

  groupes.attribue.sort((a, b) => b.date.localeCompare(a.date));
  groupes.vie.sort((a, b) => b.date.localeCompare(a.date));
  /* Les consultations encore ouvertes d'abord, la plus proche de sa clôture en
     tête : c'est le seul ordre qui dise quoi faire aujourd'hui. Viennent
     ensuite celles qui viennent de fermer (attribution imminente), puis les
     avis sans date limite — ceux-là ne disent pas quand ils ferment. */
  const maintenant = Date.now();
  const rang = (a: Actualite) => {
    if (!a.dateLimite) return 2;
    return new Date(a.dateLimite).getTime() >= maintenant ? 0 : 1;
  };
  groupes.a_venir.sort((a, b) => {
    const ra = rang(a);
    const rb = rang(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (a.dateLimite as string).localeCompare(b.dateLimite as string);
    if (ra === 1) return (b.dateLimite as string).localeCompare(a.dateLimite as string);
    return b.date.localeCompare(a.date);
  });

  return groupes;
}

export function compterTypes(actualites: Actualite[]): Map<string, number> {
  const parType = new Map<string, number>();
  for (const a of actualites) parType.set(a.type, (parType.get(a.type) ?? 0) + 1);
  return parType;
}

/** Jours restants avant la date limite ; négatif si elle est passée. */
export function joursRestants(dateLimite: string, now: Date = new Date()): number {
  return Math.ceil((new Date(dateLimite).getTime() - now.getTime()) / 86400000);
}

/** « ferme dans 3 j », « ferme demain », « dernier jour ». */
export function urgenceLisible(dateLimite: string, now: Date = new Date()): string {
  const j = joursRestants(dateLimite, now);
  if (j < 0) return "clôturé";
  if (j === 0) return "dernier jour";
  if (j === 1) return "ferme demain";
  return `ferme dans ${j} j`;
}
