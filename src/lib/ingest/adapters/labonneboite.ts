/**
 * France Travail — La Bonne Boîte v2 : potentiel d'embauche par établissement
 * (1 à 5 étoiles), calculé par France Travail sur les DPAE des 12 derniers mois
 * pour prédire les 3 suivants.
 *
 * ÉTAT VÉRIFIÉ le 28/08/2026 : le jeton OAuth2 est bien délivré avec
 * `scope=api_labonneboitev2` (même URL de jeton que l'API Offres), mais tous les
 * chemins essayés répondent 403 —
 *   /partenaire/labonneboite/v2/recherche          → 403 « Invalid scope »
 *   /partenaire/labonneboite/v2/entreprises        → 403 (corps vide)
 *   /partenaire/labonneboite/v2/company/           → 403 (corps vide)
 *   /partenaire/labonneboite/v1/company/           → 403 (corps vide)
 * La documentation du produit (francetravail.io, application Angular) n'est pas
 * lisible sans navigateur. INCERTITUDE ASSUMÉE : l'endpoint, les noms de
 * paramètres et la forme de la réponse sont des hypothèses (calquées sur la v1 :
 * rome_codes / latitude / longitude / distance, réponse { companies: [{ siret,
 * stars… }] }). Tout est surchargeable par variables d'environnement :
 *   LBB_ENDPOINT        URL complète (défaut : …/partenaire/labonneboite/v2/recherche)
 *   LBB_PARAM_ROME      nom du paramètre métier (défaut : rome)
 *   LBB_PARAM_LAT / LBB_PARAM_LON / LBB_PARAM_DISTANCE (défauts : latitude, longitude, distance)
 * et le parsing cherche défensivement, dans la réponse, une liste d'objets porteurs
 * d'un `siret` et d'un score (score, stars, etoiles, potentiel, note, hiring_potential…).
 *
 * Aucun signal : la source pose un ATTRIBUT d'établissement (lbbScore 0-5, lbbMaj),
 * lu par le Strate. Quota annoncé sur le catalogue : 2 appels/seconde.
 */
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const URL_JETON = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
export const SCOPE_LBB = "api_labonneboitev2";
export const ENDPOINT_DEFAUT = "https://api.francetravail.io/partenaire/labonneboite/v2/recherche";
const limiter = new RateLimiter(2);

export type LbbRaw = {
  siret: string;
  score: number;
  rome: string | null;
  nom: string | null;
};

let jetonCache: { valeur: string; expireA: number } | null = null;

export async function obtenirJetonLbb(): Promise<string> {
  if (jetonCache && Date.now() < jetonCache.expireA) return jetonCache.valeur;
  const clientId = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "[labonneboite] FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET absents (voir README).",
    );
  }
  const res = await fetch(URL_JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE_LBB,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `[labonneboite] jeton refusé (HTTP ${res.status}) pour le scope « ${SCOPE_LBB} » : ` +
        "l'application n'est probablement pas abonnée à « La Bonne Boîte v2 » sur francetravail.io.",
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  jetonCache = { valeur: body.access_token, expireA: Date.now() + Math.max(0, body.expires_in - 60) * 1000 };
  return jetonCache.valeur;
}

const CLES_SCORE = ["score", "stars", "etoiles", "potentiel", "note", "hiring_potential", "potentielEmbauche", "nb_etoiles"];

/** Ramène un score exprimé en étoiles (0-5), en pourcentage ou en 0-1 sur l'échelle 0-5. */
export function normaliserScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return Math.round(n * 5 * 10) / 10;
  if (n <= 5) return Math.round(n * 10) / 10;
  if (n <= 100) return Math.round((n / 20) * 10) / 10;
  return null;
}

/** Cherche récursivement des objets porteurs d'un SIRET et d'un score. */
export function extraireEntreprises(body: unknown, rome: string | null): LbbRaw[] {
  const out: LbbRaw[] = [];
  const visiter = (node: unknown, profondeur: number) => {
    if (profondeur > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const x of node) visiter(x, profondeur + 1);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const siret = typeof o.siret === "string" ? o.siret.replace(/\D/g, "") : null;
    if (siret && siret.length === 14) {
      let score: number | null = null;
      for (const k of CLES_SCORE) {
        if (k in o) {
          score = normaliserScore(o[k]);
          if (score != null) break;
        }
      }
      if (score != null) {
        const nom = typeof o.name === "string" ? o.name : typeof o.nom === "string" ? o.nom : null;
        out.push({ siret, score, rome, nom });
        return;
      }
    }
    for (const v of Object.values(o)) visiter(v, profondeur + 1);
  };
  visiter(body, 0);
  return out;
}

export const labonneboiteAdapter: SourceAdapter<LbbRaw> = {
  id: "labonneboite",

  async *fetch(params: FetchParams): AsyncIterable<LbbRaw> {
    if (params.lat == null || params.lon == null || params.rayonKm == null) {
      throw new Error("[labonneboite] paramètres requis : position et rayon de l'agence");
    }
    const romes = params.romes && params.romes.length > 0 ? params.romes : [];
    if (romes.length === 0) {
      console.warn("[labonneboite] aucun métier ROME cible : rien à interroger");
      return;
    }
    const endpoint = process.env.LBB_ENDPOINT ?? ENDPOINT_DEFAUT;
    const pRome = process.env.LBB_PARAM_ROME ?? "rome";
    const pLat = process.env.LBB_PARAM_LAT ?? "latitude";
    const pLon = process.env.LBB_PARAM_LON ?? "longitude";
    const pDist = process.env.LBB_PARAM_DISTANCE ?? "distance";
    const jeton = await obtenirJetonLbb();
    const vus = new Map<string, LbbRaw>();

    for (const rome of romes) {
      const url =
        `${endpoint}?${pRome}=${encodeURIComponent(rome)}&${pLat}=${params.lat}&${pLon}=${params.lon}` +
        `&${pDist}=${Math.min(100, Math.round(params.rayonKm))}`;
      const body = await fetchJsonCache("labonneboite", url, limiter, {
        headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" },
        maxTentatives: 2,
      });
      for (const e of extraireEntreprises(body, rome)) {
        // Le meilleur score sur l'ensemble des métiers cibles fait foi.
        const deja = vus.get(e.siret);
        if (!deja || e.score > deja.score) vus.set(e.siret, e);
      }
    }
    for (const e of vus.values()) yield e;
  },

  normalize(raw: LbbRaw): NormalizedRecord[] {
    if (!/^\d{14}$/.test(raw.siret)) return [];
    return [
      {
        kind: "attribut",
        siret: raw.siret,
        attributs: { lbbScore: raw.score, lbbMaj: new Date().toISOString().slice(0, 10) },
      },
    ];
  },

  fixture(): LbbRaw[] {
    return [
      { siret: "90090000100019", score: 4, rome: "F1703", nom: "DEMO BATIMENT BOURBONNAIS" },
      { siret: "90090000200018", score: 2.5, rome: "N1103", nom: "DEMO LOGISTIQUE ALLIER" },
    ];
  },
};
