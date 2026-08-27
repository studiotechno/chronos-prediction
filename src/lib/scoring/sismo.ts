/**
 * Sismo — score événementiel 0..100. Les déclencheurs datés, avec décroissance temporelle.
 *
 * contribution = poids_type × confidence × facteurs × exp(-ln(2) × age_jours / demi_vie_type)
 * puis somme, puis normalisation logistique recalée pour que 0 contribution → 0
 * et qu'une entreprise à 50 offres n'écrase pas le classement.
 */
import { signalTypeLabel } from "./labels";
import type {
  ScoreComponent,
  SignalContribution,
  SignalScoringInput,
  SismoResult,
  WeightMap,
} from "./types";

const LN2 = Math.log(2);

/** CPV à fort recours à l'intérim : BTP (45), transport (60), logistique (63), espaces verts (77), propreté (90). */
const CPV_CIBLES = ["45", "60", "63", "77", "90"];

export type SismoContext = {
  weights: WeightMap;
  romeCibles: string[];
  now: Date;
};

export function computeSismo(signals: SignalScoringInput[], ctx: SismoContext): SismoResult {
  const w = ctx.weights;
  const contributions: SignalContribution[] = [];

  for (const s of signals) {
    const poids = w[`sismo.poids.${s.type}`];
    const demiVie = w[`sismo.demivie.${s.type}`];
    if (poids === undefined || demiVie === undefined || poids === 0) continue;

    const ageJours = Math.max(0, (ctx.now.getTime() - new Date(s.occurredAt).getTime()) / 86400000);
    const decay = Math.exp((-LN2 * ageJours) / demiVie);

    let facteur = 1;

    // Offres : un métier hors des ROME cibles de l'agence pèse beaucoup moins
    const rome = typeof s.payload?.rome === "string" ? (s.payload.rome as string) : null;
    if (rome && s.type.startsWith("OFFRE")) {
      if (!ctx.romeCibles.includes(rome)) facteur *= w["sismo.rome_hors_cible"];
    }

    // Marchés publics : pondérés par le montant et par le CPV
    if (s.type === "MARCHE_ATTRIBUE") {
      const montant = typeof s.payload?.montant === "number" ? (s.payload.montant as number) : null;
      if (montant != null) {
        facteur *= Math.max(0.2, Math.min(1, montant / w["sismo.marche.montant_ref"]));
      }
      const cpv = typeof s.payload?.cpv === "string" ? (s.payload.cpv as string) : "";
      if (!CPV_CIBLES.some((p) => cpv.startsWith(p))) {
        facteur *= w["sismo.marche.cpv_hors_cible"];
      }
    }

    contributions.push({
      id: s.id,
      type: s.type,
      occurredAt: s.occurredAt,
      contribution: round2(poids * s.confidence * facteur * decay),
    });
  }

  const sommeBrute = contributions.reduce((s, c) => s + c.contribution, 0);
  const score = normalisationLogistique(sommeBrute, w);

  // Agrégation par type pour les barres de décomposition
  const parType = new Map<string, number>();
  for (const c of contributions) {
    parType.set(c.type, (parType.get(c.type) ?? 0) + c.contribution);
  }
  const components: ScoreComponent[] = [...parType.entries()]
    .map(([type, contribution]) => ({
      key: type,
      labelFr: signalTypeLabel(type),
      contribution: round2(contribution),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { score, sommeBrute: round2(sommeBrute), components, contributions };
}

/**
 * Logistique recalée : L(x) = 1 / (1 + exp(-(x - midpoint) / pente)),
 * renormalisée pour que somme 0 → score 0 et somme +∞ → 100.
 * Une somme négative (malus BODACC) donne 0.
 */
export function normalisationLogistique(somme: number, w: WeightMap): number {
  const mid = w["sismo.norm.midpoint"];
  const pente = w["sismo.norm.pente"];
  const L = (x: number) => 1 / (1 + Math.exp(-(x - mid) / pente));
  const zero = L(0);
  const score = (100 * (L(somme) - zero)) / (1 - zero);
  return round2(Math.max(0, Math.min(100, score)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
