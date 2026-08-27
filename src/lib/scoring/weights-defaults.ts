/**
 * Registre des poids de scoring. Seule source de vérité des valeurs par défaut.
 * Les valeurs vivantes sont dans la table `weights` (éditables via /reglages) ;
 * ce fichier sert au seed et aux tests.
 */

export type WeightDef = {
  key: string;
  value: number;
  min: number;
  max: number;
  labelFr: string;
  descriptionFr: string;
};

export const SIGNAL_TYPES = [
  "OFFRE_DIRECTE",
  "OFFRE_VELOCITE",
  "OFFRE_REPUBLIEE",
  "CDD_COURT_REPETE",
  "MISSION_CONCURRENT",
  "MARCHE_ATTRIBUE",
  "EFFECTIF_UP",
  "BODACC_CAPITAL",
  "BODACC_RISQUE",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

export const WEIGHT_DEFAULTS: WeightDef[] = [
  // -------------------------------------------------------------- Strate
  {
    key: "strate.naf.max",
    value: 30,
    min: 0,
    max: 40,
    labelFr: "Secteur : contribution max",
    descriptionFr:
      "Points maximum apportés par l'intensité de recours à l'intérim du code NAF (table DARES).",
  },
  {
    key: "strate.naf.taux_ref",
    value: 8,
    min: 1,
    max: 20,
    labelFr: "Secteur : taux de saturation (%)",
    descriptionFr:
      "Taux de recours à l'intérim (en %) à partir duquel la contribution secteur est maximale.",
  },
  {
    key: "strate.effectif.max",
    value: 20,
    min: 0,
    max: 30,
    labelFr: "Effectif : contribution max",
    descriptionFr: "Points maximum pour une tranche d'effectif idéale (cloche centrée 20–250 salariés).",
  },
  {
    key: "strate.effectif.centre",
    value: 70,
    min: 10,
    max: 500,
    labelFr: "Effectif : centre de la cloche",
    descriptionFr: "Effectif (en salariés) où la contribution est maximale.",
  },
  {
    key: "strate.effectif.sigma",
    value: 1.26,
    min: 0.3,
    max: 3,
    labelFr: "Effectif : largeur de la cloche",
    descriptionFr:
      "Écart-type de la cloche en échelle logarithmique. 1.26 donne ~60 % de la contribution à 20 et 250 salariés.",
  },
  {
    key: "strate.distance.max",
    value: 20,
    min: 0,
    max: 30,
    labelFr: "Distance : contribution max",
    descriptionFr: "Points maximum pour un établissement au pied de l'agence.",
  },
  {
    key: "strate.distance.lambda",
    value: 0.35,
    min: 0.05,
    max: 1,
    labelFr: "Distance : vitesse de décroissance",
    descriptionFr:
      "Décroissance exponentielle exp(-d / (λ × rayon)). Plus λ est petit, plus la distance pénalise vite.",
  },
  {
    key: "strate.anciennete.max",
    value: 10,
    min: 0,
    max: 20,
    labelFr: "Ancienneté : contribution max",
    descriptionFr: "Points maximum pour un établissement ancien et stable.",
  },
  {
    key: "strate.anciennete.annees_plein",
    value: 5,
    min: 1,
    max: 20,
    labelFr: "Ancienneté : années pour le plein",
    descriptionFr: "Nombre d'années d'existence à partir duquel la contribution ancienneté est maximale.",
  },
  {
    key: "strate.sante.max",
    value: 20,
    min: 0,
    max: 30,
    labelFr: "Santé : contribution max",
    descriptionFr:
      "Points maximum de la composante santé (absence de procédure collective, comptes déposés au BODACC).",
  },
  {
    key: "strate.sante.malus_procedure",
    value: 0.25,
    min: 0,
    max: 1,
    labelFr: "Santé : malus procédure collective",
    descriptionFr:
      "Multiplicateur appliqué au Strate ENTIER si une procédure collective est en cours (0.25 = score divisé par 4). L'impayé est le coût caché n°1 en intérim.",
  },
  {
    key: "strate.multi_etab.bonus",
    value: 2,
    min: 0,
    max: 10,
    labelFr: "Multi-établissements : bonus unitaire",
    descriptionFr: "Points par établissement supplémentaire du même SIREN sur le bassin.",
  },
  {
    key: "strate.multi_etab.max",
    value: 6,
    min: 0,
    max: 20,
    labelFr: "Multi-établissements : plafond",
    descriptionFr: "Plafond du bonus multi-établissements.",
  },

  // -------------------------------------------------------------- Sismo : poids par type de signal
  {
    key: "sismo.poids.OFFRE_DIRECTE",
    value: 12,
    min: 0,
    max: 50,
    labelFr: "Poids : offre directe",
    descriptionFr: "Offre postée par l'entreprise elle-même (pas par une agence d'intérim).",
  },
  {
    key: "sismo.poids.OFFRE_VELOCITE",
    value: 15,
    min: 0,
    max: 50,
    labelFr: "Poids : accélération d'offres",
    descriptionFr: "Volume d'offres sur 14 jours anormalement élevé vs la baseline 90 jours.",
  },
  {
    key: "sismo.poids.OFFRE_REPUBLIEE",
    value: 20,
    min: 0,
    max: 50,
    labelFr: "Poids : offre republiée",
    descriptionFr: "Même intitulé republié après clôture : ils n'arrivent pas à recruter.",
  },
  {
    key: "sismo.poids.CDD_COURT_REPETE",
    value: 15,
    min: 0,
    max: 50,
    labelFr: "Poids : CDD courts répétés",
    descriptionFr: "Au moins 3 CDD < 3 mois sur 60 jours : besoin intérimable mal servi.",
  },
  {
    key: "sismo.poids.MISSION_CONCURRENT",
    value: 0,
    min: 0,
    max: 50,
    labelFr: "Poids : mission concurrente",
    descriptionFr:
      "Ne score pas l'entreprise (0 par construction) — alimente la carte de couverture concurrentielle.",
  },
  {
    key: "sismo.poids.MARCHE_ATTRIBUE",
    value: 25,
    min: 0,
    max: 60,
    labelFr: "Poids : marché public attribué",
    descriptionFr: "Marché attribué, pondéré par le montant (voir montant de référence) et le CPV.",
  },
  {
    key: "sismo.poids.EFFECTIF_UP",
    value: 10,
    min: 0,
    max: 50,
    labelFr: "Poids : croissance d'effectif",
    descriptionFr: "Passage à une tranche d'effectif supérieure d'une année sur l'autre.",
  },
  {
    key: "sismo.poids.BODACC_CAPITAL",
    value: 10,
    min: 0,
    max: 50,
    labelFr: "Poids : augmentation de capital",
    descriptionFr: "Augmentation de capital ou fusion au BODACC.",
  },
  {
    key: "sismo.poids.BODACC_RISQUE",
    value: -40,
    min: -100,
    max: 0,
    labelFr: "Poids : procédure collective (malus)",
    descriptionFr: "Signal négatif fort : procédure collective en cours.",
  },

  // -------------------------------------------------------------- Sismo : demi-vies (jours)
  {
    key: "sismo.demivie.OFFRE_DIRECTE",
    value: 21,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : offre directe (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.OFFRE_VELOCITE",
    value: 21,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : accélération d'offres (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.OFFRE_REPUBLIEE",
    value: 30,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : offre republiée (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.CDD_COURT_REPETE",
    value: 45,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : CDD courts répétés (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.MISSION_CONCURRENT",
    value: 60,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : mission concurrente (j)",
    descriptionFr: "Décroissance utilisée par la carte de couverture concurrentielle.",
  },
  {
    key: "sismo.demivie.MARCHE_ATTRIBUE",
    value: 90,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : marché attribué (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.EFFECTIF_UP",
    value: 180,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : croissance d'effectif (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.BODACC_CAPITAL",
    value: 90,
    min: 1,
    max: 365,
    labelFr: "Demi-vie : augmentation de capital (j)",
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux.",
  },
  {
    key: "sismo.demivie.BODACC_RISQUE",
    value: 365,
    min: 1,
    max: 730,
    labelFr: "Demi-vie : procédure collective (j)",
    descriptionFr: "Le malus d'une procédure collective persiste longtemps.",
  },

  // -------------------------------------------------------------- Sismo : normalisation logistique
  {
    key: "sismo.norm.midpoint",
    value: 30,
    min: 1,
    max: 100,
    labelFr: "Normalisation : point médian",
    descriptionFr:
      "Somme brute de contributions donnant un Sismo de 50. La normalisation logistique évite qu'une entreprise à 50 offres écrase le classement.",
  },
  {
    key: "sismo.norm.pente",
    value: 12,
    min: 1,
    max: 50,
    labelFr: "Normalisation : pente",
    descriptionFr: "Pente de la logistique. Plus elle est faible, plus la courbe est abrupte.",
  },
  {
    key: "sismo.rome_hors_cible",
    value: 0.25,
    min: 0,
    max: 1,
    labelFr: "Facteur ROME hors cible",
    descriptionFr:
      "Multiplicateur appliqué aux signaux d'offres dont le métier (ROME) n'est pas dans les cibles de l'agence. Neutralise le bruit des secteurs non intérimables (ex. cabinet de conseil).",
  },
  {
    key: "sismo.marche.cpv_hors_cible",
    value: 0.6,
    min: 0,
    max: 1,
    labelFr: "Facteur CPV hors cible",
    descriptionFr:
      "Multiplicateur des marchés publics dont le CPV n'est ni BTP (45), ni propreté (90), ni transport (60), ni espaces verts (77), ni logistique (63).",
  },
  {
    key: "sismo.marche.montant_ref",
    value: 500000,
    min: 10000,
    max: 5000000,
    labelFr: "Marché : montant de référence (€)",
    descriptionFr: "Montant de marché public à partir duquel le poids MARCHE_ATTRIBUE est plein.",
  },

  // -------------------------------------------------------------- Score final
  {
    key: "final.alpha",
    value: 0.4,
    min: 0,
    max: 2,
    labelFr: "Exposant Strate (α)",
    descriptionFr: "final = 100 × (strate/100)^α × (sismo/100)^β. Multiplicatif, pas additif.",
  },
  {
    key: "final.beta",
    value: 0.6,
    min: 0,
    max: 2,
    labelFr: "Exposant Sismo (β)",
    descriptionFr: "final = 100 × (strate/100)^α × (sismo/100)^β. Multiplicatif, pas additif.",
  },
  {
    key: "final.seuil_chaud",
    value: 15,
    min: 0,
    max: 100,
    labelFr: "Seuil Sismo « lead chaud »",
    descriptionFr:
      "En dessous de ce Sismo, l'entreprise ne peut pas être un lead chaud, quel que soit son Strate : elle part en nurturing.",
  },
];

export type WeightMap = Record<string, number>;

export function defaultWeightMap(): WeightMap {
  return Object.fromEntries(WEIGHT_DEFAULTS.map((w) => [w.key, w.value]));
}
