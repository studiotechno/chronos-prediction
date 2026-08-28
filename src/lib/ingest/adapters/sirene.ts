/**
 * SIRENE — API Recherche d'entreprises (data.gouv.fr).
 * ENDPOINT VÉRIFIÉ le 28/08/2026 par appel réel (voir docs/sources.md) :
 *   GET https://recherche-entreprises.api.gouv.fr/near_point
 *       ?lat=&long=&radius=&activite_principale=&page=&per_page=
 *       &minimal=true&include=finances,complements,siege,matching_etablissements
 * Ouverte, sans clé, limite annoncée 7 req/s (voir le limiteur ci-dessous).
 * Rayon max utile : 50 km.
 *
 * Piège vérifié : `include` n'est accepté qu'avec `minimal=true` (sinon l'API
 * répond « Veuillez indiquer si vous souhaitez une réponse minimale… »).
 * Avec ces deux paramètres, la réponse porte ce que le V0 ignorait :
 *   · finances { "2024": { ca, resultat_net } } — RNE, dernier(s) exercice(s) ;
 *   · complements.liste_idcc — conventions collectives déclarées en DSN ;
 *   · caractere_employeur (O/N), nombre_etablissements_ouverts ;
 *   · par établissement : liste_idcc, liste_enseignes, nom_commercial,
 *     commune (code INSEE), date_debut_activite, caractere_employeur.
 * Un chiffre d'affaires à 0 signifie « non renseigné » : il devient null.
 */
import { z } from "zod";
import { effectifEstime } from "../../reference/tranches";
import { fetchJsonCache, RateLimiter } from "../http";
import type {
  EntrepriseRecord,
  EtablissementFields,
  FetchParams,
  NormalizedRecord,
  SourceAdapter,
} from "../types";
import { nombreFini } from "../nombre";

const BASE = "https://recherche-entreprises.api.gouv.fr";
// 7 req/s est la limite annoncée ; en pratique l'API renvoie des 429 bien avant
// sur des rafales soutenues. On part à 5 et le limiteur se ralentit tout seul.
const limiter = new RateLimiter(5);

/** Champs à demander en plus de la réponse minimale. */
export const INCLUDE = "finances,complements,siege,matching_etablissements";

const etabSchema = z.object({
  siret: z.string(),
  activite_principale: z.string().nullable(),
  code_postal: z.string().nullable(),
  libelle_commune: z.string().nullable(),
  /** Code INSEE de la commune. */
  commune: z.string().nullish(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  date_creation: z.string().nullable(),
  date_debut_activite: z.string().nullish(),
  etat_administratif: z.string().nullable(),
  est_siege: z.boolean(),
  tranche_effectif_salarie: z.string().nullable(),
  caractere_employeur: z.string().nullish(),
  liste_enseignes: z.array(z.string()).nullable().optional(),
  nom_commercial: z.string().nullish(),
  liste_idcc: z.array(z.string()).nullish(),
});

const financesSchema = z.record(
  z.string(),
  z.object({ ca: z.number().nullish(), resultat_net: z.number().nullish() }).passthrough(),
);

const complementsSchema = z
  .object({
    liste_idcc: z.array(z.string()).nullish(),
  })
  .passthrough();

export const sireneResultSchema = z.object({
  siren: z.string(),
  nom_complet: z.string(),
  nom_raison_sociale: z.string().nullable(),
  categorie_entreprise: z.string().nullable(),
  date_creation: z.string().nullable(),
  etat_administratif: z.string().nullable(),
  activite_principale: z.string().nullable(),
  tranche_effectif_salarie: z.string().nullable(),
  caractere_employeur: z.string().nullish(),
  nombre_etablissements_ouverts: z.number().nullish(),
  finances: financesSchema.nullish(),
  complements: complementsSchema.nullish(),
  /** Présent avec include=siege ; c'est là que vit l'établissement quand on cherche par SIREN. */
  siege: etabSchema.nullish(),
  matching_etablissements: z.array(etabSchema).default([]),
});

const pageSchema = z.object({
  results: z.array(z.unknown()),
  total_results: z.number(),
  page: z.number(),
  total_pages: z.number(),
});

export type SireneRaw = z.infer<typeof sireneResultSchema>;
export type SireneEtabRaw = z.infer<typeof etabSchema>;

/** Un montant RNE à 0 est un « non renseigné », pas un chiffre d'affaires nul. */
function montantOuNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;
}

export type Finances = {
  caAnnee: number | null;
  ca: number | null;
  caPrecedent: number | null;
  resultatNet: number | null;
  resultatNetPrecedent: number | null;
};

/**
 * Finances du dernier exercice déposé, et de l'exercice immédiatement précédent
 * s'il est publié (une année isolée ne dit rien d'une tendance).
 */
export function lireFinances(finances: SireneRaw["finances"]): Finances {
  const vide: Finances = { caAnnee: null, ca: null, caPrecedent: null, resultatNet: null, resultatNetPrecedent: null };
  if (!finances) return vide;
  const annees = Object.keys(finances)
    .map(Number)
    .filter((a) => Number.isFinite(a))
    .sort((a, b) => b - a);
  if (annees.length === 0) return vide;
  const derniere = annees[0];
  const dernier = finances[String(derniere)];
  const precedent = finances[String(derniere - 1)];
  return {
    caAnnee: derniere,
    ca: montantOuNull(dernier?.ca),
    caPrecedent: precedent ? montantOuNull(precedent.ca) : null,
    resultatNet: typeof dernier?.resultat_net === "number" ? dernier.resultat_net : null,
    resultatNetPrecedent: precedent && typeof precedent.resultat_net === "number" ? precedent.resultat_net : null,
  };
}

/** Seuls les indicateurs booléens des compléments sont conservés (jamais les listes d'identifiants). */
function lireComplements(c: SireneRaw["complements"]): Record<string, unknown> | null {
  if (!c) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if ((k.startsWith("est_") || k === "egapro_renseignee" || k === "convention_collective_renseignee") && typeof v === "boolean") {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function nettoyerListe(l: string[] | null | undefined): string[] | null {
  if (!l) return null;
  const propre = l.map((s) => s.trim()).filter(Boolean);
  return propre.length > 0 ? propre : null;
}

export function normaliserEtablissement(raw: SireneRaw, e: SireneEtabRaw, denomination: string): EtablissementFields {
  const tranche = e.tranche_effectif_salarie;
  return {
    siret: e.siret,
    siren: raw.siren,
    denomination,
    naf: e.activite_principale ?? raw.activite_principale ?? "",
    trancheEffectif: tranche,
    trancheEffectifSource: tranche && tranche !== "NN" ? "sirene" : null,
    effectifEstime: effectifEstime(tranche),
    codePostal: e.code_postal,
    commune: e.libelle_commune,
    codeInsee: e.commune ?? null,
    lat: nombreFini(e.latitude),
    lon: nombreFini(e.longitude),
    dateCreation: e.date_creation,
    dateDebutActivite: e.date_debut_activite ?? null,
    etatAdministratif: e.etat_administratif,
    estSiege: e.est_siege ? 1 : 0,
    caractereEmployeur: e.caractere_employeur ?? null,
    enseignes: nettoyerListe(e.liste_enseignes),
    nomCommercial: e.nom_commercial?.trim() || null,
    idcc: nettoyerListe(e.liste_idcc),
  };
}

/**
 * Lecture complète d'un résultat de l'API : l'unité légale (finances, IDCC,
 * caractère employeur) et ses établissements. Quand on interroge par SIREN,
 * `matching_etablissements` est vide et l'établissement vit dans `siege` :
 * on prend les deux, sans doublon.
 */
export function normaliserResultat(raw: SireneRaw): {
  entreprise: EntrepriseRecord;
  etablissements: EtablissementFields[];
} {
  const denomination = raw.nom_raison_sociale ?? raw.nom_complet;
  const finances = lireFinances(raw.finances);
  const entreprise: EntrepriseRecord = {
    siren: raw.siren,
    denomination,
    categorie: raw.categorie_entreprise,
    dateCreation: raw.date_creation,
    etat: raw.etat_administratif,
    caractereEmployeur: raw.caractere_employeur ?? raw.siege?.caractere_employeur ?? null,
    nbEtabsOuverts: raw.nombre_etablissements_ouverts ?? null,
    ...finances,
    idcc: nettoyerListe(raw.complements?.liste_idcc),
    complements: lireComplements(raw.complements),
  };

  const vus = new Set<string>();
  const etablissements: EtablissementFields[] = [];
  for (const e of [...raw.matching_etablissements, ...(raw.siege ? [raw.siege] : [])]) {
    if (!e.activite_principale || vus.has(e.siret)) continue;
    vus.add(e.siret);
    etablissements.push(normaliserEtablissement(raw, e, denomination));
  }
  return { entreprise, etablissements };
}

export const sireneAdapter: SourceAdapter<SireneRaw> = {
  id: "sirene",

  async *fetch(params: FetchParams): AsyncIterable<SireneRaw> {
    if (params.lat == null || params.lon == null || params.rayonKm == null) {
      throw new Error("[sirene] paramètres requis : --lat --lon --rayon (km, max 50)");
    }
    const rayon = Math.min(50, params.rayonKm);
    // L'API filtre par code NAF complet ; une requête par NAF ciblé.
    // Sans NAF fourni, une seule passe non filtrée (bruyante : à éviter en vrai).
    const nafs = params.nafs && params.nafs.length > 0 ? params.nafs : [null];

    for (const naf of nafs) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const url =
          `${BASE}/near_point?lat=${params.lat}&long=${params.lon}&radius=${rayon}` +
          (naf ? `&activite_principale=${encodeURIComponent(naf)}` : "") +
          `&page=${page}&per_page=25&minimal=true&include=${INCLUDE}`;
        const body = pageSchema.parse(await fetchJsonCache("sirene", url, limiter));
        totalPages = Math.min(body.total_pages, 40); // garde-fou volumétrie
        for (const brut of body.results) {
          const parsed = sireneResultSchema.safeParse(brut);
          if (parsed.success) yield parsed.data;
          else throw new Error(`[sirene] réponse inattendue : ${parsed.error.issues[0]?.message}`);
        }
        page++;
      }
    }
  },

  normalize(raw: SireneRaw): NormalizedRecord[] {
    const { entreprise, etablissements } = normaliserResultat(raw);
    // Sur near_point, seuls les établissements DANS le rayon (matching) font partie
    // du référentiel : le siège lointain d'une chaîne nationale n'y a pas sa place.
    const dansLeRayon = new Set(raw.matching_etablissements.map((e) => e.siret));
    return etablissements
      .filter((e) => dansLeRayon.size === 0 || dansLeRayon.has(e.siret))
      .map((etablissement) => ({ kind: "etablissement" as const, entreprise, etablissement }));
  },

  fixture(): SireneRaw[] {
    return [
      {
        siren: "900900001",
        nom_complet: "DEMO BATIMENT BOURBONNAIS",
        nom_raison_sociale: "DEMO BATIMENT BOURBONNAIS",
        categorie_entreprise: "PME",
        date_creation: "2011-03-15",
        etat_administratif: "A",
        activite_principale: "43.99C",
        tranche_effectif_salarie: "21",
        caractere_employeur: "O",
        nombre_etablissements_ouverts: 1,
        finances: { "2024": { ca: 6200000, resultat_net: 210000 }, "2023": { ca: 5100000, resultat_net: 140000 } },
        complements: { liste_idcc: ["1597", "2609"], est_rge: true },
        siege: null,
        matching_etablissements: [
          {
            siret: "90090000100019",
            activite_principale: "43.99C",
            code_postal: "03200",
            libelle_commune: "VICHY",
            commune: "03310",
            latitude: "46.127",
            longitude: "3.426",
            date_creation: "2011-03-15",
            date_debut_activite: "2011-03-15",
            etat_administratif: "A",
            est_siege: true,
            tranche_effectif_salarie: "21",
            caractere_employeur: "O",
            liste_enseignes: null,
            nom_commercial: null,
            liste_idcc: ["1597"],
          },
        ],
      },
      {
        siren: "900900002",
        nom_complet: "DEMO LOGISTIQUE ALLIER",
        nom_raison_sociale: "DEMO LOGISTIQUE ALLIER",
        categorie_entreprise: "PME",
        date_creation: "2016-09-01",
        etat_administratif: "A",
        activite_principale: "52.10B",
        tranche_effectif_salarie: "12",
        caractere_employeur: "O",
        nombre_etablissements_ouverts: 1,
        finances: { "2024": { ca: 0, resultat_net: 30000 } },
        complements: { liste_idcc: ["16"] },
        siege: null,
        matching_etablissements: [
          {
            siret: "90090000200018",
            activite_principale: "52.10B",
            code_postal: "03150",
            libelle_commune: "VARENNES-SUR-ALLIER",
            commune: "03298",
            latitude: "46.312",
            longitude: "3.402",
            date_creation: "2016-09-01",
            date_debut_activite: "2016-09-01",
            etat_administratif: "A",
            est_siege: true,
            tranche_effectif_salarie: "12",
            caractere_employeur: "O",
            liste_enseignes: ["DEMO LOG"],
            nom_commercial: null,
            liste_idcc: ["16"],
          },
        ],
      },
    ];
  },
};
