/**
 * Géorisques — installations classées pour la protection de l'environnement (ICPE).
 * ENDPOINT VÉRIFIÉ le 28/08/2026 par appels réels (voir docs/sources.md) :
 *   GET https://georisques.gouv.fr/api/v1/installations_classees
 *       ?latlon=<longitude>,<latitude>&rayon=<mètres>&page=&page_size=
 *
 * Pièges vérifiés :
 *   - `latlon` est LONGITUDE,LATITUDE (dans cet ordre) ;
 *   - `rayon` est plafonné à 20 000 m (« Le rayon de recherche ne doit pas dépasser
 *     20000 mètres », HTTP 500 au-delà) — un rayon d'agence plus large est couvert
 *     par une grille de centres ;
 *   - `page_size=1000` est accepté ; réponse { results, page, total_pages, next, data[] } ;
 *   - `regime` vaut aussi « Non ICPE » et « Autres régimes » ; `etatActivite` est
 *     souvent nul. On ne retient que les sites classés (régime Autorisation,
 *     Enregistrement, Déclaration…) qui ne sont pas « En fin d'exploitation ».
 *
 * Aucun signal : la source pose un ATTRIBUT d'établissement (icpe, icpeRegime),
 * lu par le Strate. Un SIRET absent du référentiel est ignoré.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const BASE = "https://georisques.gouv.fr/api/v1/installations_classees";
const limiter = new RateLimiter(3);
/** Plafond de l'API, vérifié par appel réel. */
export const RAYON_MAX_M = 20000;
const PAGE_SIZE = 1000;

export const icpeSchema = z.object({
  raisonSociale: z.string().nullish(),
  siret: z.string().nullish(),
  codeInsee: z.string().nullish(),
  commune: z.string().nullish(),
  codeNaf: z.string().nullish(),
  regime: z.string().nullish(),
  statutSeveso: z.string().nullish(),
  etatActivite: z.string().nullish(),
  codeAIOT: z.string().nullish(),
  industrie: z.boolean().nullish(),
  longitude: z.number().nullish(),
  latitude: z.number().nullish(),
});

const pageSchema = z.object({
  results: z.number().nullish(),
  page: z.number().nullish(),
  total_pages: z.number().nullish(),
  data: z.array(z.unknown()).default([]),
});

export type IcpeRaw = z.infer<typeof icpeSchema>;

/**
 * Centres de recherche couvrant un disque de `rayonKm` autour de (lat, lon) avec
 * des disques de 20 km : le centre, puis une grille carrée au pas de 28 km
 * (20 × √2, pour qu'aucun point du carré n'échappe aux quatre disques voisins).
 */
export function centresCouverture(lat: number, lon: number, rayonKm: number): { lat: number; lon: number }[] {
  const rayonDisque = RAYON_MAX_M / 1000;
  if (rayonKm <= rayonDisque) return [{ lat, lon }];
  const pas = rayonDisque * Math.SQRT2;
  const kmParDegLat = 111.32;
  const kmParDegLon = 111.32 * Math.cos((lat * Math.PI) / 180);
  const n = Math.ceil(rayonKm / pas);
  const centres: { lat: number; lon: number }[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const dy = i * pas;
      const dx = j * pas;
      // Un centre dont le disque ne touche pas la zone n'apporte rien.
      if (Math.hypot(dx, dy) > rayonKm + rayonDisque) continue;
      centres.push({
        lat: Math.round((lat + dy / kmParDegLat) * 1e5) / 1e5,
        lon: Math.round((lon + dx / kmParDegLon) * 1e5) / 1e5,
      });
    }
  }
  return centres;
}

const REGIMES_HORS_CIBLE = /non icpe|autres r[ée]gimes/i;

/** Site classé en activité : régime réel, pas en fin d'exploitation. */
export function estSiteClasseActif(raw: IcpeRaw): boolean {
  if (!raw.regime || REGIMES_HORS_CIBLE.test(raw.regime)) return false;
  if (raw.etatActivite && /fin d.exploitation|cess/i.test(raw.etatActivite)) return false;
  return true;
}

export const georisquesAdapter: SourceAdapter<IcpeRaw> = {
  id: "georisques",

  async *fetch(params: FetchParams): AsyncIterable<IcpeRaw> {
    if (params.lat == null || params.lon == null || params.rayonKm == null) {
      throw new Error("[georisques] paramètres requis : --lat --lon --rayon (km)");
    }
    const centres = centresCouverture(params.lat, params.lon, params.rayonKm);
    const rayonM = Math.min(RAYON_MAX_M, Math.round(params.rayonKm * 1000));
    const vus = new Set<string>();

    for (const c of centres) {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const url = `${BASE}?latlon=${c.lon},${c.lat}&rayon=${rayonM}&page=${page}&page_size=${PAGE_SIZE}`;
        const body = pageSchema.parse(await fetchJsonCache("georisques", url, limiter));
        totalPages = Math.min(body.total_pages ?? 1, 50);
        for (const brut of body.data) {
          const parsed = icpeSchema.safeParse(brut);
          if (!parsed.success) throw new Error(`[georisques] réponse inattendue : ${parsed.error.issues[0]?.message}`);
          const cle = parsed.data.siret ?? parsed.data.codeAIOT ?? JSON.stringify(brut).slice(0, 80);
          if (vus.has(cle)) continue;
          vus.add(cle);
          yield parsed.data;
        }
        if (body.data.length === 0) break;
        page++;
      }
    }
  },

  normalize(raw: IcpeRaw): NormalizedRecord[] {
    const siret = raw.siret?.replace(/\s/g, "");
    if (!siret || !/^\d{14}$/.test(siret)) return [];
    if (!estSiteClasseActif(raw)) return [];
    return [
      {
        kind: "attribut",
        siret,
        attributs: { icpe: 1, icpeRegime: raw.regime ?? null },
      },
    ];
  },

  fixture(): IcpeRaw[] {
    return [
      {
        raisonSociale: "DEMO LOGISTIQUE ALLIER",
        siret: "90090000200018",
        codeInsee: "03298",
        commune: "Varennes-sur-Allier",
        codeNaf: "52",
        regime: "Enregistrement",
        statutSeveso: "Non Seveso",
        etatActivite: "En exploitation avec titre",
        codeAIOT: "0003200001",
        industrie: true,
        longitude: 3.402,
        latitude: 46.312,
      },
      {
        raisonSociale: "DEMO CARRIERE FERMEE",
        siret: "90090000300017",
        codeInsee: "03310",
        commune: "Vichy",
        codeNaf: "08",
        regime: "Autorisation",
        statutSeveso: "Non Seveso",
        etatActivite: "En fin d'exploitation",
        codeAIOT: "0003200002",
        industrie: false,
        longitude: 3.426,
        latitude: 46.127,
      },
      {
        raisonSociale: "DEMO GARAGE",
        siret: "90090000400016",
        codeInsee: "03310",
        commune: "Vichy",
        codeNaf: "45",
        regime: "Non ICPE",
        statutSeveso: null,
        etatActivite: null,
        codeAIOT: "0003200003",
        industrie: false,
        longitude: 3.43,
        latitude: 46.13,
      },
    ];
  },
};
