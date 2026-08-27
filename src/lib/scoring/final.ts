/**
 * Score final — multiplicatif, pas additif :
 * final = 100 × (strate/100)^α × (sismo/100)^β
 * Règle métier : si sismo < seuil_chaud, l'entreprise ne peut pas être un lead chaud,
 * quel que soit son Strate → segment « nurturing », hors du flux principal.
 */
import type { WeightMap } from "./types";

export function computeFinal(
  strate: number,
  sismo: number,
  w: WeightMap,
): { scoreFinal: number; segment: "chaud" | "nurturing" } {
  const alpha = w["final.alpha"];
  const beta = w["final.beta"];
  const scoreFinal =
    strate <= 0 || sismo <= 0
      ? 0
      : 100 * Math.pow(strate / 100, alpha) * Math.pow(sismo / 100, beta);
  const segment = sismo < w["final.seuil_chaud"] ? "nurturing" : "chaud";
  return { scoreFinal: Math.round(scoreFinal * 100) / 100, segment };
}
