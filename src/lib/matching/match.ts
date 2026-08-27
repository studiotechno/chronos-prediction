/**
 * Rapprochement d'entité : raison sociale brute (source externe) → SIRET du référentiel.
 *
 * Pipeline : normalisation → blocage par code postal / département →
 * similarité combinée (Jaro-Winkler sur tokens triés + trigrammes) → bonus NAF →
 * seuils de décision :
 *   ≥ 0.88            rapprochement automatique, confidence = score
 *   0.62 à 0.88       file de résolution manuelle
 *   < 0.62            rejet loggé
 */
import { normalizeDenomination } from "./normalize";
import { jaroWinkler } from "./jaro-winkler";
import { trigramSimilarity } from "./trigram";

export const SEUIL_AUTO = 0.88;
export const SEUIL_AMBIGU = 0.62;

const STOPWORDS = new Set(["ET", "DE", "DES", "DU", "LA", "LE", "LES", "L", "D", "A", "AU", "AUX", "EN"]);

export type CandidatEtab = {
  siret: string;
  denomination: string;
  codePostal: string | null;
  commune: string | null;
  naf: string | null;
};

export type RawEntity = {
  denomination: string;
  codePostal?: string | null;
  naf?: string | null;
};

export type MatchCandidat = CandidatEtab & { similarite: number };

export type MatchResult =
  | { decision: "auto"; candidat: MatchCandidat; candidats: MatchCandidat[] }
  | { decision: "ambigu"; candidats: MatchCandidat[] }
  | { decision: "rejet"; meilleur: MatchCandidat | null };

/** Tokens triés : rend Jaro-Winkler robuste à l'inversion de mots (« TRANSPORTS DURAND » / « DURAND TRANSPORTS »). */
function tokenSort(s: string): string {
  return s.split(" ").sort().join(" ");
}

export function similarite(brutA: string, brutB: string, nafA?: string | null, nafB?: string | null): number {
  const a = normalizeDenomination(brutA);
  const b = normalizeDenomination(brutB);
  if (a.length === 0 || b.length === 0) return 0;

  const jw = jaroWinkler(tokenSort(a), tokenSort(b));
  const tri = trigramSimilarity(a, b);
  let score = 0.55 * jw + 0.45 * tri;

  // Garde-fou : si un nom est un sur-ensemble STRICT de tokens de l'autre
  // (« VINCI CONSTRUCTION FRANCE » ⊃ « VINCI CONSTRUCTION », « MENUISERIE FABRE
  // FRERES » ⊃ « MENUISERIE FABRE »), le token en plus est souvent distinctif :
  // filiale, commune, branche familiale. Jamais d'auto-rattachement, file manuelle.
  // Les mots-outils (ET, DE, DU...) ne comptent pas comme distinctifs.
  const tokensA = new Set(a.split(" ").filter((t) => !STOPWORDS.has(t)));
  const tokensB = new Set(b.split(" ").filter((t) => !STOPWORDS.has(t)));
  if (tokensA.size !== tokensB.size) {
    const [petit, grand] = tokensA.size < tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
    if ([...petit].every((t) => grand.has(t))) {
      score = Math.min(score, SEUIL_AUTO - 0.01);
    }
  }

  // Bonus si le NAF concorde (division identique)
  if (nafA && nafB) {
    const divA = nafA.replace(/[^0-9]/g, "").slice(0, 2);
    const divB = nafB.replace(/[^0-9]/g, "").slice(0, 2);
    if (divA && divA === divB) score = Math.min(1, score + 0.04);
  }

  return Math.round(score * 1000) / 1000;
}

export function matchEntity(raw: RawEntity, referentiel: CandidatEtab[]): MatchResult {
  // Blocage : même code postal d'abord, sinon même département, sinon tout le référentiel.
  const cp = raw.codePostal ?? null;
  const dep = cp ? cp.slice(0, 2) : null;

  let bloc = cp ? referentiel.filter((e) => e.codePostal === cp) : [];
  if (bloc.length === 0 && dep) bloc = referentiel.filter((e) => e.codePostal?.startsWith(dep));
  if (bloc.length === 0) bloc = referentiel;

  const scores: MatchCandidat[] = bloc
    .map((e) => ({ ...e, similarite: similarite(raw.denomination, e.denomination, raw.naf, e.naf) }))
    .sort((a, b) => b.similarite - a.similarite);

  const top = scores.slice(0, 3);
  const meilleur = top[0] ?? null;

  if (meilleur && meilleur.similarite >= SEUIL_AUTO) {
    return { decision: "auto", candidat: meilleur, candidats: top };
  }
  if (meilleur && meilleur.similarite >= SEUIL_AMBIGU) {
    return { decision: "ambigu", candidats: top.filter((c) => c.similarite >= SEUIL_AMBIGU - 0.05) };
  }
  return { decision: "rejet", meilleur };
}
