/**
 * Strate — score structurel 0..100, le fit ICP. Change lentement.
 * Somme pondérée de composantes explicables, tous les poids dans la table `weights`.
 *
 * V2 : le secteur se lit d'abord sur la convention collective (IDCC), la taille
 * se reconstruit en cascade (tranche INSEE → tranche France Travail → chiffre
 * d'affaires → caractère employeur), la santé lit les comptes déposés, la
 * distance se mesure au LIEU DU BESOIN quand un signal en porte un, et deux
 * composantes s'ajoutent : site industriel classé, potentiel d'embauche.
 */
import { distanceKm } from "./geo";
import type {
  AgenceScoringInput,
  EtabScoringInput,
  ScoreComponent,
  StrateResult,
  WeightMap,
} from "./types";

export type LectureSecteur = { tauxPct: number; detailFr: string; exclu?: boolean };

export type StrateContext = {
  agence: AgenceScoringInput;
  weights: WeightMap;
  /** Taux de recours à l'intérim (%) du secteur — IDCC d'abord, division NAF sinon. */
  tauxRecours: (naf: string, idcc: string[]) => LectureSecteur;
  /** Procédure collective en cours (BODACC_RISQUE actif). */
  aProcedureCollective: boolean;
  /** PSE, RCC ou accord de maintien dans l'emploi récent (ACCORD_RESTRUCTURATION). */
  aRestructuration: boolean;
  /** Lieu du besoin le plus proche de l'agence porté par un signal récent, s'il y en a un. */
  lieuBesoin: { km: number; libelle: string | null } | null;
  now: Date;
};

/**
 * Chiffre d'affaires moyen par salarié, par section NAF (ordre de grandeur, en €).
 * Sert uniquement à estimer une taille quand l'INSEE ne publie pas de tranche.
 */
const CA_PAR_SALARIE: Record<string, number> = {
  A: 120000,
  B: 250000,
  C: 220000,
  D: 600000,
  E: 200000,
  F: 130000,
  G: 350000,
  H: 150000,
  I: 60000,
  J: 150000,
  K: 300000,
  L: 400000,
  M: 120000,
  N: 45000,
  Q: 50000,
  DEFAULT: 150000,
};

function sectionDe(naf: string): string {
  const d = Number(naf.replace(/[^0-9]/g, "").slice(0, 2));
  if (!Number.isFinite(d)) return "DEFAULT";
  if (d <= 3) return "A";
  if (d <= 9) return "B";
  if (d <= 33) return "C";
  if (d === 35) return "D";
  if (d <= 39) return "E";
  if (d <= 43) return "F";
  if (d <= 47) return "G";
  if (d <= 53) return "H";
  if (d <= 56) return "I";
  if (d <= 63) return "J";
  if (d <= 66) return "K";
  if (d === 68) return "L";
  if (d <= 75) return "M";
  if (d <= 82) return "N";
  if (d <= 88) return "Q";
  return "DEFAULT";
}

/** Cloche log-normale centrée sur la cible (20–250 salariés). */
function cloche(effectif: number, w: WeightMap): number {
  if (!(effectif > 0)) return 0;
  const ecart = Math.log(effectif) - Math.log(w["strate.effectif.centre"]);
  return Math.exp(-(ecart * ecart) / (2 * w["strate.effectif.sigma"] ** 2));
}

export type EstimationTaille = { effectif: number | null; contribution: number; detailFr: string };

/**
 * Cascade de taille : la tranche INSEE si elle existe (ou celle vue chez France
 * Travail), sinon une estimation par le chiffre d'affaires, sinon le caractère
 * employeur. Chaque niveau dit d'où il vient.
 */
export function estimerTaille(etab: EtabScoringInput, w: WeightMap): EstimationTaille {
  const max = w["strate.effectif.max"];
  if (etab.effectifEstime != null && etab.effectifEstime >= 0 && etab.trancheEffectif) {
    const origine =
      etab.trancheEffectifSource === "francetravail"
        ? "tranche publiée par France Travail"
        : "tranche INSEE";
    return {
      effectif: etab.effectifEstime,
      contribution: max * cloche(etab.effectifEstime, w),
      detailFr:
        etab.effectifEstime === 0 ? `0 salarié (${origine})` : `≈ ${etab.effectifEstime} salariés (${origine})`,
    };
  }
  if (etab.ca != null && etab.ca > 0) {
    const ratio = CA_PAR_SALARIE[sectionDe(etab.naf)] ?? CA_PAR_SALARIE.DEFAULT;
    const estime = Math.max(1, Math.round(etab.ca / ratio));
    return {
      effectif: estime,
      contribution: max * cloche(estime, w),
      detailFr: `≈ ${estime} salariés (estimé sur un CA de ${montantCourt(etab.ca)})`,
    };
  }
  if (etab.caractereEmployeur === "N") {
    return { effectif: 0, contribution: 0, detailFr: "Sans salarié (INSEE)" };
  }
  if (etab.caractereEmployeur === "O") {
    return {
      effectif: null,
      contribution: max * w["strate.effectif.prior_inconnu"],
      detailFr: "Employeur (INSEE), effectif non publié",
    };
  }
  return {
    effectif: null,
    contribution: max * w["strate.effectif.prior_inconnu"] * 0.5,
    detailFr: "Effectif inconnu",
  };
}

function montantCourt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  return `${Math.round(n / 1000)} k€`;
}

export function computeStrate(etab: EtabScoringInput, ctx: StrateContext): StrateResult {
  const w = ctx.weights;
  const components: ScoreComponent[] = [];

  // 1. Intensité intérimaire du secteur (IDCC, à défaut division NAF)
  const secteur = ctx.tauxRecours(etab.naf, etab.idcc ?? []);
  const nafMax = w["strate.naf.max"];
  const nafContribution = secteur.exclu ? 0 : nafMax * Math.min(1, secteur.tauxPct / w["strate.naf.taux_ref"]);
  components.push({
    key: "naf",
    labelFr: "Intensité intérim du secteur",
    contribution: round2(nafContribution),
    max: nafMax,
    detailFr: secteur.detailFr,
  });

  // 2. Taille — cascade INSEE → France Travail → chiffre d'affaires → caractère employeur
  const taille = estimerTaille(etab, w);
  components.push({
    key: "effectif",
    labelFr: "Taille de l'établissement",
    contribution: round2(taille.contribution),
    max: w["strate.effectif.max"],
    detailFr: taille.detailFr,
  });

  // 3. Distance — au lieu du besoin quand un signal en porte un, sinon à l'établissement
  const distMax = w["strate.distance.max"];
  let distContribution = 0;
  let distDetail = "Coordonnées inconnues";
  let distanceRetenue: number | null = null;
  let lieuFr: string | null = null;
  // `Number.isFinite` et non `!= null` : une source peut livrer NaN là où elle
  // annonce un nombre (SIRENE et ses « [NON-DIFFUSIBLE] »), et un NaN traverserait
  // silencieusement la distance puis le score entier.
  const dEtab =
    Number.isFinite(etab.lat) && Number.isFinite(etab.lon)
      ? distanceKm(etab.lat!, etab.lon!, ctx.agence.lat, ctx.agence.lon)
      : null;
  const dBesoin = ctx.lieuBesoin && Number.isFinite(ctx.lieuBesoin.km) ? ctx.lieuBesoin.km : null;
  if (dBesoin != null && (dEtab == null || dBesoin < dEtab)) {
    distanceRetenue = dBesoin;
    lieuFr = ctx.lieuBesoin?.libelle ?? null;
    distDetail =
      `${dBesoin.toFixed(1)} km — besoin${lieuFr ? ` à ${lieuFr}` : ""}` +
      (dEtab != null ? ` (établissement à ${dEtab.toFixed(0)} km)` : "");
  } else if (dEtab != null) {
    distanceRetenue = dEtab;
    distDetail = `${dEtab.toFixed(1)} km de l'agence`;
  }
  if (distanceRetenue != null) {
    distContribution = distMax * Math.exp(-distanceRetenue / (w["strate.distance.lambda"] * ctx.agence.rayonKm));
  }
  components.push({
    key: "distance",
    labelFr: "Proximité du besoin",
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

  // 5. Santé — comptes déposés, tendance du CA, procédures, restructuration
  const santeMax = w["strate.sante.max"];
  let santeContribution: number;
  let santeDetail: string;
  if (ctx.aProcedureCollective) {
    santeContribution = 0;
    santeDetail = "Procédure collective en cours";
  } else {
    const morceaux: string[] = [];
    let facteur = 1;
    if (etab.resultatNet != null || etab.ca != null) {
      if (etab.resultatNet != null && etab.resultatNet < 0) {
        facteur *= w["strate.sante.malus_resultat_negatif"];
        morceaux.push("dernier résultat net négatif");
      } else if (etab.resultatNet != null) {
        morceaux.push("dernier résultat net positif");
      }
      if (etab.ca != null && etab.caPrecedent != null && etab.caPrecedent > 0) {
        const delta = (etab.ca - etab.caPrecedent) / etab.caPrecedent;
        if (delta <= -0.15) {
          facteur *= w["strate.sante.malus_ca_baisse"];
          morceaux.push(`CA en baisse de ${Math.round(-delta * 100)} %`);
        } else if (delta >= 0.15) {
          morceaux.push(`CA en hausse de ${Math.round(delta * 100)} %`);
        }
      }
    } else {
      facteur *= 0.85;
      morceaux.push("comptes non publiés");
    }
    if (ctx.aRestructuration) {
      facteur *= w["strate.sante.malus_restructuration"];
      morceaux.push("accord de restructuration récent");
    }
    santeContribution = santeMax * facteur;
    santeDetail = `Aucune procédure collective connue${morceaux.length ? " · " + morceaux.join(" · ") : ""}`;
  }
  components.push({
    key: "sante",
    labelFr: "Santé de l'entreprise",
    contribution: round2(santeContribution),
    max: santeMax,
    detailFr: santeDetail,
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

  // 7. Site industriel classé
  if (etab.icpe) {
    components.push({
      key: "site",
      labelFr: "Site industriel classé",
      contribution: round2(w["strate.site.icpe"]),
      max: w["strate.site.icpe"],
      detailFr: "Installation classée (ICPE) recensée par Géorisques",
    });
  }

  // 8. Potentiel d'embauche (La Bonne Boîte)
  if (etab.lbbScore != null && Number.isFinite(etab.lbbScore)) {
    const lbbMax = w["strate.lbb.max"];
    const part = Math.max(0, Math.min(1, etab.lbbScore / 5));
    components.push({
      key: "lbb",
      labelFr: "Potentiel d'embauche (France Travail)",
      contribution: round2(lbbMax * part),
      max: lbbMax,
      detailFr: `${etab.lbbScore.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} étoiles sur 5 à La Bonne Boîte`,
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

  return {
    score: round2(Math.max(0, Math.min(100, score))),
    components,
    distanceKm: distanceRetenue != null ? Math.round(distanceRetenue * 10) / 10 : null,
    lieuFr,
  };
}

/**
 * Arrondi à deux décimales. Un score n'est jamais NaN : une entrée non finie
 * vaut zéro plutôt que de contaminer la somme, l'affichage et la base.
 */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
