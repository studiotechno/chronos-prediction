/* ── Recherche de commune (API Découpage administratif, sans clé) ─────
   https://geo.api.gouv.fr — service public ouvert, pas de quota déclaré,
   pas d'inscription. C'est la même philosophie que le reste du projet :
   aucune source payante dans le chemin critique. */

export interface Commune {
  code: string;
  nom: string;
  codePostal: string | null;
  departement: string | null;
  departementNom: string | null;
  population: number | null;
  lat: number;
  lon: number;
}

interface ReponseGeo {
  code: string;
  nom: string;
  codesPostaux?: string[];
  population?: number;
  centre?: { coordinates: [number, number] };
  departement?: { code: string; nom: string };
}

const CHAMPS = "nom,code,codesPostaux,centre,population,departement";

/**
 * Communes correspondant à une saisie — par nom, ou par code postal si la
 * saisie est numérique. Les plus peuplées d'abord : à nom égal, c'est
 * presque toujours celle qu'on cherche.
 */
export async function chercherCommunes(saisie: string, signal?: AbortSignal): Promise<Commune[]> {
  const q = saisie.trim();
  if (q.length < 2) return [];

  const parCodePostal = /^\d{2,5}$/.test(q);
  const url = parCodePostal
    ? `https://geo.api.gouv.fr/communes?codePostal=${encodeURIComponent(q)}&fields=${CHAMPS}&limit=10`
    : `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=${CHAMPS}&boost=population&limit=10`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Recherche de commune indisponible (${res.status})`);
  const brut = (await res.json()) as ReponseGeo[];

  return brut
    .filter((c) => c.centre?.coordinates)
    .map((c) => ({
      code: c.code,
      nom: c.nom,
      codePostal: c.codesPostaux?.[0] ?? null,
      departement: c.departement?.code ?? null,
      departementNom: c.departement?.nom ?? null,
      population: c.population ?? null,
      lon: c.centre!.coordinates[0],
      lat: c.centre!.coordinates[1],
    }))
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
}
