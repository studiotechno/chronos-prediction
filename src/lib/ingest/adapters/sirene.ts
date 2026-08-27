/**
 * SIRENE — API Recherche d'entreprises (data.gouv.fr).
 * ENDPOINT VÉRIFIÉ le 27/08/2026 par appel réel (voir docs/sources.md) :
 *   GET https://recherche-entreprises.api.gouv.fr/near_point
 *       ?lat=&long=&radius=&activite_principale=&page=&per_page=
 * Ouverte, sans clé, LIMITÉE À 7 REQ/S (limiteur strict ci-dessous).
 * Rayon max utile : 50 km.
 */
import { z } from "zod";
import { effectifEstime } from "../../reference/tranches";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const BASE = "https://recherche-entreprises.api.gouv.fr";
const limiter = new RateLimiter(7);

const etabSchema = z.object({
  siret: z.string(),
  activite_principale: z.string().nullable(),
  code_postal: z.string().nullable(),
  libelle_commune: z.string().nullable(),
  latitude: z.string().nullable(),
  longitude: z.string().nullable(),
  date_creation: z.string().nullable(),
  etat_administratif: z.string().nullable(),
  est_siege: z.boolean(),
  tranche_effectif_salarie: z.string().nullable(),
  liste_enseignes: z.array(z.string()).nullable().optional(),
});

export const sireneResultSchema = z.object({
  siren: z.string(),
  nom_complet: z.string(),
  nom_raison_sociale: z.string().nullable(),
  categorie_entreprise: z.string().nullable(),
  date_creation: z.string().nullable(),
  etat_administratif: z.string().nullable(),
  activite_principale: z.string().nullable(),
  tranche_effectif_salarie: z.string().nullable(),
  matching_etablissements: z.array(etabSchema).default([]),
});

const pageSchema = z.object({
  results: z.array(z.unknown()),
  total_results: z.number(),
  page: z.number(),
  total_pages: z.number(),
});

export type SireneRaw = z.infer<typeof sireneResultSchema>;

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
          `&page=${page}&per_page=25`;
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
    const records: NormalizedRecord[] = [];
    const denomination = raw.nom_raison_sociale ?? raw.nom_complet;
    for (const e of raw.matching_etablissements) {
      if (!e.activite_principale) continue;
      records.push({
        kind: "etablissement",
        entreprise: {
          siren: raw.siren,
          denomination,
          categorie: raw.categorie_entreprise,
          dateCreation: raw.date_creation,
          etat: raw.etat_administratif,
        },
        etablissement: {
          siret: e.siret,
          siren: raw.siren,
          denomination,
          naf: e.activite_principale,
          trancheEffectif: e.tranche_effectif_salarie,
          effectifEstime: effectifEstime(e.tranche_effectif_salarie),
          codePostal: e.code_postal,
          commune: e.libelle_commune,
          lat: e.latitude ? Number(e.latitude) : null,
          lon: e.longitude ? Number(e.longitude) : null,
          dateCreation: e.date_creation,
          etatAdministratif: e.etat_administratif,
          estSiege: e.est_siege ? 1 : 0,
        },
      });
    }
    return records;
  },

  fixture(): SireneRaw[] {
    return [
      {
        siren: "900900001",
        nom_complet: "DEMO BATIMENT MEDITERRANEE",
        nom_raison_sociale: "DEMO BATIMENT MEDITERRANEE",
        categorie_entreprise: "PME",
        date_creation: "2011-03-15",
        etat_administratif: "A",
        activite_principale: "43.99C",
        tranche_effectif_salarie: "21",
        matching_etablissements: [
          {
            siret: "90090000100019",
            activite_principale: "43.99C",
            code_postal: "13011",
            libelle_commune: "MARSEILLE",
            latitude: "43.289",
            longitude: "5.475",
            date_creation: "2011-03-15",
            etat_administratif: "A",
            est_siege: true,
            tranche_effectif_salarie: "21",
            liste_enseignes: null,
          },
        ],
      },
      {
        siren: "900900002",
        nom_complet: "DEMO LOGISTIQUE PROVENCE",
        nom_raison_sociale: "DEMO LOGISTIQUE PROVENCE",
        categorie_entreprise: "PME",
        date_creation: "2016-09-01",
        etat_administratif: "A",
        activite_principale: "52.10B",
        tranche_effectif_salarie: "12",
        matching_etablissements: [
          {
            siret: "90090000200018",
            activite_principale: "52.10B",
            code_postal: "13127",
            libelle_commune: "VITROLLES",
            latitude: "43.46",
            longitude: "5.248",
            date_creation: "2016-09-01",
            etat_administratif: "A",
            est_siege: true,
            tranche_effectif_salarie: "12",
            liste_enseignes: null,
          },
        ],
      },
    ];
  },
};
