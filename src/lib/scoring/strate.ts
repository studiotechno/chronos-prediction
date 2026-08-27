/**
 * Strate — score structurel 0..100, le fit ICP. Change lentement.
 * Somme pondérée de composantes explicables, tous les poids dans la table `weights`.
 */
import { distanceKm } from "./geo";
import type {
  AgenceScoringInput,
  EtabScoringInput,
  ScoreComponent,
  StrateResult,
  WeightMap,
} from "./types";

export type StrateContext = {
  agence: AgenceScoringInput;
  weights: WeightMap;
  /** Taux de recours à l'intérim (%) pour un code NAF (table DARES). */
  tauxRecours: (naf: string) => number;
  /** Procédure collective en cours (BODACC_RISQUE actif). */
  aProcedureCollective: boolean;
  /** Dépôt des comptes vu au BODACC (léger bonus santé). */
  aDepotComptes: boolean;
  now: Date;
};

export function computeStrate(etab: EtabScoringInput, ctx: StrateContext): StrateResult {
  const w = ctx.weights;
  const components: ScoreComponent[] = [];

  // 1. Intensité intérimaire du secteur (table DARES)
  const taux = ctx.tauxRecours(etab.naf);
  const nafMax = w["strate.naf.max"];
  const nafContribution = nafMax * Math.min(1, taux / w["strate.naf.taux_ref"]);
  components.push({
    key: "naf",
    labelFr: "Intensité intérim du secteur",
    contribution: round2(nafContribution),
    max: nafMax,
    detailFr: `Taux de recours du secteur : ${taux.toLocaleString("fr-FR")} %`,
  });

  // 2. Tranche d'effectif — cloche log-normale centrée sur la cible (20–250 salariés)
  const effMax = w["strate.effectif.max"];
  let effContribution = 0;
  let effDetail = "Effectif inconnu";
  if (etab.effectifEstime && etab.effectifEstime > 0) {
    const ecart = Math.log(etab.effectifEstime) - Math.log(w["strate.effectif.centre"]);
    effContribution = effMax * Math.exp(-(ecart * ecart) / (2 * w["strate.effectif.sigma"] ** 2));
    effDetail = `≈ ${etab.effectifEstime} salariés`;
  }
  components.push({
    key: "effectif",
    labelFr: "Taille de l'établissement",
    contribution: round2(effContribution),
    max: effMax,
    detailFr: effDetail,
  });

  // 3. Distance à l'agence — décroissance exponentielle sur le rayon configuré
  const distMax = w["strate.distance.max"];
  let distContribution = 0;
  let distDetail = "Coordonnées inconnues";
  if (etab.lat != null && etab.lon != null) {
    const d = distanceKm(etab.lat, etab.lon, ctx.agence.lat, ctx.agence.lon);
    distContribution = distMax * Math.exp(-d / (w["strate.distance.lambda"] * ctx.agence.rayonKm));
    distDetail = `${d.toFixed(1)} km de l'agence`;
  }
  components.push({
    key: "distance",
    labelFr: "Proximité de l'agence",
    contribution: round2(distContribution),
    max: distMax,
    detailFr: distDetail,
  });

  // 4. Ancienneté et stabilité
  const ancMax = w["strate.anciennete.max"];
  let ancContribution = 0;
  let ancDetail = "Date de création inconnue";
  if (etab.dateCreation) {
    const annees = (ctx.now.getTime() - new Date(etab.dateCreation).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (annees > 0) {
      ancContribution = ancMax * Math.min(1, annees / w["strate.anciennete.annees_plein"]);
      ancDetail = `${Math.floor(annees)} ans d'existence`;
    }
  }
  components.push({
    key: "anciennete",
    labelFr: "Ancienneté",
    contribution: round2(ancContribution),
    max: ancMax,
    detailFr: ancDetail,
  });

  // 5. Santé
  const santeMax = w["strate.sante.max"];
  const santeContribution = ctx.aProcedureCollective ? 0 : santeMax * (ctx.aDepotComptes ? 1 : 0.85);
  components.push({
    key: "sante",
    labelFr: "Santé de l'entreprise",
    contribution: round2(santeContribution),
    max: santeMax,
    detailFr: ctx.aProcedureCollective
      ? "Procédure collective en cours"
      : ctx.aDepotComptes
        ? "Comptes déposés, aucune procédure collective connue"
        : "Aucune procédure collective connue",
  });

  // 6. Bonus multi-établissements sur le bassin
  const multiContribution = Math.min(
    w["strate.multi_etab.max"],
    Math.max(0, etab.nbEtabsBassin - 1) * w["strate.multi_etab.bonus"],
  );
  if (multiContribution > 0) {
    components.push({
      key: "multi_etab",
      labelFr: "Multi-établissements",
      contribution: round2(multiContribution),
      max: w["strate.multi_etab.max"],
      detailFr: `${etab.nbEtabsBassin} établissements sur le bassin`,
    });
  }

  let score = components.reduce((s, c) => s + c.contribution, 0);

  // Malus MULTIPLICATIF (et non additif) si procédure collective en cours
  if (ctx.aProcedureCollective) {
    const avant = score;
    score = score * w["strate.sante.malus_procedure"];
    components.push({
      key: "sante.malus",
      labelFr: "Malus procédure collective (×)",
      contribution: round2(score - avant),
      detailFr: `Score multiplié par ${w["strate.sante.malus_procedure"].toLocaleString("fr-FR")}`,
    });
  }

  return { score: round2(Math.max(0, Math.min(100, score))), components };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
