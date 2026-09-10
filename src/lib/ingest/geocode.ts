/**
 * Géocodage de communes — API Découpage administratif (geo.api.gouv.fr), sans clé.
 * ENDPOINTS VÉRIFIÉS le 10/09/2026 par appels réels :
 *   GET https://geo.api.gouv.fr/communes?codePostal=03300&fields=nom,code,centre,population
 *   GET https://geo.api.gouv.fr/communes?nom=Cusset&codeDepartement=03&fields=…&boost=population
 *   GET https://geo.api.gouv.fr/communes/03095?fields=nom,code,centre,population
 * Un code postal couvre plusieurs communes : on retient la plus peuplée. Les
 * « cedex » et suffixes administratifs sont retirés avant la recherche par nom.
 *
 * Sert à donner un LIEU DU BESOIN aux marchés publics (adresse de l'acheteur au
 * BOAMP, code postal d'exécution au DECP) : c'est ce lieu, pas le siège du
 * titulaire, que le Socle mesure.
 */
import { fetchJsonCache, RateLimiter } from "./http";

const BASE = "https://geo.api.gouv.fr";
const CHAMPS = "nom,code,centre,population";
const limiter = new RateLimiter(8);
/** Une commune ne bouge pas : trente jours de cache. */
const TTL = 30 * 24 * 3600 * 1000;

export type PointCommune = { lat: number; lon: number; libelle: string; codeInsee: string | null };

type ReponseCommune = {
  code?: string;
  nom?: string;
  population?: number;
  centre?: { coordinates?: [number, number] };
};

const memoire = new Map<string, PointCommune | null>();

function versPoint(c: ReponseCommune): PointCommune | null {
  const coords = c.centre?.coordinates;
  if (!coords || coords.length < 2) return null;
  const [lon, lat] = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, libelle: c.nom ?? "", codeInsee: c.code ?? null };
}

async function lire(url: string): Promise<ReponseCommune[]> {
  try {
    const body = await fetchJsonCache("geo", url, limiter, { ttlMs: TTL, maxTentatives: 2 });
    if (Array.isArray(body)) return body as ReponseCommune[];
    if (body && typeof body === "object") return [body as ReponseCommune];
  } catch {
    // un géocodage raté ne doit jamais interrompre une ingestion
  }
  return [];
}

/** « Clermont-Ferrand cedex 1 » → « Clermont-Ferrand », « MOULINS CEDEX » → « MOULINS ». */
export function nettoyerNomCommune(nom: string | null | undefined): string | null {
  if (!nom) return null;
  const propre = nom
    .replace(/\bcedex\b.*$/i, "")
    .replace(/\bcs\s*\d+.*$/i, "")
    .replace(/\bbp\s*\d+.*$/i, "")
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return propre.length >= 2 ? propre : null;
}

/**
 * Point d'une commune à partir de ce qu'une source publie : code INSEE, code
 * postal, ou nom (+ département). Renvoie null plutôt que d'inventer.
 */
export async function geocoderCommune(q: {
  codeInsee?: string | null;
  codePostal?: string | null;
  nom?: string | null;
  departement?: string | null;
}): Promise<PointCommune | null> {
  const cle = JSON.stringify([q.codeInsee ?? "", q.codePostal ?? "", q.nom ?? "", q.departement ?? ""]);
  if (memoire.has(cle)) return memoire.get(cle)!;

  let point: PointCommune | null = null;

  if (q.codeInsee && /^\d[0-9AB]\d{3}$/i.test(q.codeInsee)) {
    const [c] = await lire(`${BASE}/communes/${encodeURIComponent(q.codeInsee)}?fields=${CHAMPS}`);
    point = c ? versPoint(c) : null;
  }

  const nom = nettoyerNomCommune(q.nom);

  // Un code postal « cedex » (03063) ne correspond à aucune commune : le nom prend le relais.
  if (!point && q.codePostal && /^\d{5}$/.test(q.codePostal)) {
    const communes = (await lire(`${BASE}/communes?codePostal=${q.codePostal}&fields=${CHAMPS}&limit=20`))
      .map(versPoint)
      .filter((p): p is PointCommune => !!p);
    if (communes.length > 0) {
      // Le nom, quand on l'a, départage les communes d'un même code postal.
      const parNom = nom ? communes.find((c) => c.libelle.toLowerCase() === nom.toLowerCase()) : undefined;
      point =
        parNom ??
        communes.reduce((a, b) => {
          const pa = (a as PointCommune & { population?: number }).population ?? 0;
          const pb = (b as PointCommune & { population?: number }).population ?? 0;
          return pb > pa ? b : a;
        });
    }
  }

  if (!point && nom) {
    const dept = q.departement ?? q.codePostal?.slice(0, 2) ?? null;
    const url =
      `${BASE}/communes?nom=${encodeURIComponent(nom)}` +
      (dept ? `&codeDepartement=${encodeURIComponent(dept)}` : "") +
      `&fields=${CHAMPS}&boost=population&limit=1`;
    const [c] = await lire(url);
    point = c ? versPoint(c) : null;
  }

  memoire.set(cle, point);
  return point;
}
