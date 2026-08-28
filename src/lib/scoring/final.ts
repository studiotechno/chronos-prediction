/**
 * Score final — multiplicatif, pas additif :
 * final = 100 × (strate/100)^α × (sismo/100)^β × tempo^γ
 * Règle métier : si sismo < seuil_chaud, l'entreprise ne peut pas être un lead chaud,
 * quel que soit son Strate → segment « nurturing », hors du flux principal.
 * Tempo est un facteur autour de 1 : il déplace un lead dans la semaine, il ne
 * le crée ni ne l'efface.
 */
import type { WeightMap } from "./types";

export function computeFinal(
  strate: number,
  sismo: number,
  w: WeightMap,
  tempo = 1,
): { scoreFinal: number; segment: "chaud" | "nurturing" } {
  const alpha = w["final.alpha"];
  const beta = w["final.beta"];
  const gamma = w["final.gamma"] ?? 1;
  // Une composante non finie est traitée comme nulle : mieux vaut un lead à 0,
  // visible et explicable, qu'un NaN qui se propage jusqu'à la carte et à la base.
  const strateSaine = Number.isFinite(strate) ? strate : 0;
  const sismoSain = Number.isFinite(sismo) ? sismo : 0;
  const tempoSain = Number.isFinite(tempo) && tempo > 0 ? tempo : 1;
  const brut =
    strateSaine <= 0 || sismoSain <= 0
      ? 0
      : 100 * Math.pow(strateSaine / 100, alpha) * Math.pow(sismoSain / 100, beta) * Math.pow(tempoSain, gamma);
  const scoreFinal = Math.min(100, brut);
  const segment = sismoSain < w["final.seuil_chaud"] ? "nurturing" : "chaud";
  return { scoreFinal: Math.round(scoreFinal * 100) / 100, segment };
}
