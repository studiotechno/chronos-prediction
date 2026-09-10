/**
 * Registre des poids de scoring. Seule source de vérité des valeurs par défaut.
 * Les valeurs vivantes sont dans la table `weights` (éditables via /reglages) ;
 * ce fichier sert au seed et aux tests.
 *
 * V2 — trois idées nouvelles, toutes paramétrées ici et nulle part ailleurs :
 *   · des NOYAUX À RETARD : un marché attribué ou un permis ne pèse pas au jour J
 *     mais autour d'une date de pic (sismo.noyau / sismo.pic / sismo.largeur) ;
 *   · la CORROBORATION : les contributions sont saturées par famille de source,
 *     puis bonifiées quand plusieurs familles indépendantes convergent ;
 *   · TEMPO, le « quand » : saisonnalité et conjoncture locale, borné autour de 1.
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
  // Offres (France Travail)
  "OFFRE_DIRECTE",
  "OFFRE_VELOCITE",
  "OFFRE_REPUBLIEE",
  "OFFRE_REACTUALISEE",
  "OFFRE_MANQUE_CANDIDATS",
  "OFFRE_MULTIPOSTES",
  "CDD_COURT_REPETE",
  "MISSION_CONCURRENT",
  // Commande publique (BOAMP, DECP)
  "MARCHE_ATTRIBUE",
  "AO_OUVERT",
  // Registre et finances (SIRENE, RNE, BODACC)
  "EFFECTIF_UP",
  "CA_CROISSANCE",
  "CA_BAISSE",
  "BODACC_CAPITAL",
  "BODACC_RISQUE",
  // Accords d'entreprise (ACCO)
  "ACCORD_SURCHARGE",
  "ACCORD_RESTRUCTURATION",
  // Urbanisme (Sitadel) — adapter à venir, le moteur sait déjà le scorer
  "PERMIS_LOCAUX",
  // Implantation (SIRENE) : une entreprise établie ouvre un site sur le bassin
  "ETAB_NOUVEAU",
  // Anticipation (BOAMP) : le marché du titulaire sortant est remis en concurrence
  "AO_RENOUVELLEMENT",
  // Bassin (France Travail) : offre directe sans employeur nommé — nourrit l'intérimabilité mesurée
  "DEMANDE_ANONYME",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

/**
 * Famille de source d'un type de signal : la corroboration compte les familles
 * indépendantes qui convergent, pas le nombre de signaux.
 */
export const FAMILLE_PAR_TYPE: Record<SignalType, string> = {
  OFFRE_DIRECTE: "offres",
  OFFRE_VELOCITE: "offres",
  OFFRE_REPUBLIEE: "offres",
  OFFRE_REACTUALISEE: "offres",
  OFFRE_MANQUE_CANDIDATS: "offres",
  OFFRE_MULTIPOSTES: "offres",
  CDD_COURT_REPETE: "offres",
  MISSION_CONCURRENT: "bassin",
  MARCHE_ATTRIBUE: "commande_publique",
  AO_OUVERT: "bassin",
  EFFECTIF_UP: "registre",
  CA_CROISSANCE: "registre",
  CA_BAISSE: "registre",
  BODACC_CAPITAL: "registre",
  BODACC_RISQUE: "registre",
  ACCORD_SURCHARGE: "accords",
  ACCORD_RESTRUCTURATION: "accords",
  PERMIS_LOCAUX: "urbanisme",
  ETAB_NOUVEAU: "implantation",
  AO_RENOUVELLEMENT: "commande_publique",
  DEMANDE_ANONYME: "bassin",
};

export function familleDeType(type: string): string {
  return (FAMILLE_PAR_TYPE as Record<string, string>)[type] ?? "autre";
}

/**
 * Types dont la contribution est multipliée par l'intérimabilité du besoin :
 * la part de missions d'intérim mesurée sur le bassin pour le métier de l'offre,
 * à défaut l'intensité intérim du secteur (convention collective, division NAF).
 */
export const TYPES_SECTORISES = new Set<string>([
  "OFFRE_DIRECTE",
  "OFFRE_VELOCITE",
  "OFFRE_REPUBLIEE",
  "OFFRE_REACTUALISEE",
  "OFFRE_MANQUE_CANDIDATS",
  "OFFRE_MULTIPOSTES",
  "CDD_COURT_REPETE",
]);

/**
 * Déclencheurs QUALIFIANTS : un établissement n'est un lead que s'il en porte au
 * moins un. Les autres signaux positifs (capital, chiffre d'affaires, effectif)
 * amplifient un besoin déjà manifesté, ils ne le prouvent pas — mesuré sur
 * l'Allier, 183 leads sur 512 ne tenaient qu'à une augmentation de capital, dont
 * 149 à plus de 50 km de l'agence.
 */
export const TYPES_QUALIFIANTS = new Set<string>([
  "OFFRE_DIRECTE",
  "OFFRE_VELOCITE",
  "OFFRE_REPUBLIEE",
  "OFFRE_REACTUALISEE",
  "OFFRE_MANQUE_CANDIDATS",
  "OFFRE_MULTIPOSTES",
  "CDD_COURT_REPETE",
  "MARCHE_ATTRIBUE",
  "AO_RENOUVELLEMENT",
  "ACCORD_SURCHARGE",
  "PERMIS_LOCAUX",
  "ETAB_NOUVEAU",
]);

type PoidsSignal = {
  type: SignalType;
  poids: number;
  demiVie: number;
  /** Noyau à retard : pic (jours après le signal) et largeur (écart-type en log). Absent = noyau immédiat. */
  pic?: number;
  largeur?: number;
  label: string;
  description: string;
};

const SIGNAUX: PoidsSignal[] = [
  {
    type: "OFFRE_DIRECTE",
    poids: 12,
    demiVie: 21,
    label: "offre directe",
    description: "Offre postée par l'entreprise elle-même (pas par une agence d'intérim).",
  },
  {
    type: "OFFRE_VELOCITE",
    poids: 15,
    demiVie: 21,
    label: "accélération d'offres",
    description: "Volume d'offres sur 14 jours anormalement élevé vs la baseline 90 jours.",
  },
  {
    type: "OFFRE_REPUBLIEE",
    poids: 20,
    demiVie: 30,
    label: "offre republiée",
    description: "Même intitulé republié après clôture : ils n'arrivent pas à recruter.",
  },
  {
    type: "OFFRE_REACTUALISEE",
    poids: 14,
    demiVie: 21,
    label: "offre réactualisée",
    description:
      "Offre toujours ouverte après plusieurs actualisations chez France Travail : elle ne se pourvoit pas. Mesure le temps sur le marché sans attendre la clôture.",
  },
  {
    type: "OFFRE_MANQUE_CANDIDATS",
    poids: 22,
    demiVie: 21,
    label: "offre en manque de candidats",
    description: "France Travail signale lui-même l'offre comme difficile à pourvoir.",
  },
  {
    type: "OFFRE_MULTIPOSTES",
    poids: 16,
    demiVie: 21,
    label: "offre multipostes",
    description: "Plusieurs postes sur une même offre : un recrutement de volume, pas un remplacement.",
  },
  {
    type: "CDD_COURT_REPETE",
    poids: 15,
    demiVie: 45,
    label: "CDD courts répétés",
    description: "Au moins 3 CDD < 3 mois sur 60 jours : besoin intérimable mal servi.",
  },
  {
    type: "MISSION_CONCURRENT",
    poids: 0,
    demiVie: 60,
    label: "mission concurrente",
    description:
      "Ne score pas l'entreprise (0 par construction) — alimente la carte de couverture et la conjoncture locale (Tempo).",
  },
  {
    type: "MARCHE_ATTRIBUE",
    poids: 25,
    demiVie: 90,
    pic: 75,
    largeur: 0.7,
    label: "marché public attribué",
    description:
      "Marché attribué (BOAMP le jour même, DECP avec le montant). Noyau à retard : le chantier démarre après la notification.",
  },
  {
    type: "AO_OUVERT",
    poids: 0,
    demiVie: 90,
    pic: 150,
    largeur: 0.6,
    label: "appel d'offres ouvert",
    description:
      "Signal de bassin (aucun SIRET) : les entreprises locales du descripteur vont répondre. Entre dans Tempo, pas dans le score de l'entreprise.",
  },
  {
    type: "EFFECTIF_UP",
    poids: 10,
    demiVie: 180,
    label: "croissance d'effectif",
    description: "Passage à une tranche d'effectif supérieure d'une année sur l'autre.",
  },
  {
    type: "CA_CROISSANCE",
    poids: 8,
    demiVie: 365,
    label: "chiffre d'affaires en hausse",
    description: "Chiffre d'affaires en hausse d'au moins 15 % sur le dernier exercice déposé.",
  },
  {
    type: "CA_BAISSE",
    poids: -8,
    demiVie: 365,
    label: "chiffre d'affaires en baisse",
    description: "Chiffre d'affaires en baisse d'au moins 15 % sur le dernier exercice déposé.",
  },
  {
    type: "BODACC_CAPITAL",
    poids: 10,
    demiVie: 90,
    label: "augmentation de capital",
    description: "Augmentation de capital ou fusion au BODACC.",
  },
  {
    type: "BODACC_RISQUE",
    poids: -40,
    demiVie: 365,
    label: "procédure collective (malus)",
    description: "Signal négatif fort : procédure collective en cours.",
  },
  {
    type: "ACCORD_SURCHARGE",
    poids: 14,
    demiVie: 120,
    label: "accord de surcharge",
    description:
      "Accord d'entreprise sur les heures supplémentaires, la modulation, le travail de nuit ou du dimanche : la capacité est tendue.",
  },
  {
    type: "ACCORD_RESTRUCTURATION",
    poids: -25,
    demiVie: 365,
    label: "accord de restructuration (malus)",
    description: "PSE, rupture conventionnelle collective, accord de maintien dans l'emploi.",
  },
  {
    type: "PERMIS_LOCAUX",
    poids: 18,
    demiVie: 180,
    pic: 120,
    largeur: 0.8,
    label: "permis de construire de locaux",
    description:
      "Permis de locaux non résidentiels : chantier (pic à 4 mois) puis exploitation. Noyau à retard.",
  },
  {
    type: "ETAB_NOUVEAU",
    poids: 18,
    demiVie: 120,
    pic: 45,
    largeur: 0.7,
    label: "ouverture d'un établissement",
    description:
      "Une entreprise établie depuis plus d'un an ouvre un site sur le bassin (SIRENE, date de début d'activité) : le recrutement suit l'ouverture. Noyau à retard.",
  },
  {
    type: "AO_RENOUVELLEMENT",
    poids: 15,
    demiVie: 120,
    pic: 90,
    largeur: 0.5,
    label: "marché du titulaire remis en concurrence",
    description:
      "Le même acheteur relance un appel d'offres semblable à un marché que l'entreprise détient : titulaire sortant et concurrents habituels vont devoir staffer. Le pic est calé sur la date limite de remise des offres.",
  },
  {
    type: "DEMANDE_ANONYME",
    poids: 0,
    demiVie: 60,
    label: "offre directe sans employeur nommé",
    description:
      "Ne score personne (0 par construction) : un quart des offres ne nomment pas l'employeur. Elles comptent dans l'intérimabilité mesurée des métiers du bassin.",
  },
];

/**
 * Poids par défaut du moteur, indexés par type. Sert aussi à l'UI : une puce de
 * signal se lit d'autant plus fort que le moteur lui accorde de poids — la
 * hiérarchie visuelle vient du moteur, pas d'un goût d'affichage.
 */
export const POIDS_DEFAUT_PAR_TYPE: Record<string, number> = Object.fromEntries(
  SIGNAUX.map((s) => [s.type, s.poids]),
);

export const WEIGHT_DEFAULTS: WeightDef[] = [
  // -------------------------------------------------------------- Strate
  {
    key: "strate.naf.max",
    value: 30,
    min: 0,
    max: 40,
    labelFr: "Secteur : contribution max",
    descriptionFr:
      "Points maximum apportés par l'intensité de recours à l'intérim du secteur (convention collective IDCC, à défaut division NAF).",
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
    key: "strate.effectif.prior_inconnu",
    value: 0.35,
    min: 0,
    max: 1,
    labelFr: "Effectif : part accordée quand il est inconnu",
    descriptionFr:
      "Fraction de la contribution max accordée à un établissement employeur dont on ne connaît ni tranche, ni chiffre d'affaires. 0 = le pénaliser comme un non-employeur.",
  },
  {
    key: "strate.distance.max",
    value: 20,
    min: 0,
    max: 30,
    labelFr: "Distance : contribution max",
    descriptionFr: "Points maximum pour un besoin au pied de l'agence (lieu du besoin, à défaut l'établissement).",
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
      "Points maximum de la composante santé (résultat net, tendance du chiffre d'affaires, absence de procédure collective).",
  },
  {
    key: "strate.sante.malus_procedure",
    value: 0.25,
    min: 0,
    max: 1,
    labelFr: "Santé : malus procédure collective",
    descriptionFr:
      "Multiplicateur appliqué au Socle ENTIER si une procédure collective est en cours (0.25 = score divisé par 4). L'impayé est le coût caché n°1 en intérim.",
  },
  {
    key: "strate.sante.malus_resultat_negatif",
    value: 0.6,
    min: 0,
    max: 1,
    labelFr: "Santé : facteur si résultat net négatif",
    descriptionFr: "Multiplicateur de la composante santé quand le dernier résultat net déposé est négatif.",
  },
  {
    key: "strate.sante.malus_ca_baisse",
    value: 0.85,
    min: 0,
    max: 1,
    labelFr: "Santé : facteur si chiffre d'affaires en baisse",
    descriptionFr: "Multiplicateur de la composante santé quand le chiffre d'affaires a reculé d'au moins 15 % sur le dernier exercice.",
  },
  {
    key: "strate.sante.malus_restructuration",
    value: 0.5,
    min: 0,
    max: 1,
    labelFr: "Santé : facteur si accord de restructuration",
    descriptionFr: "Multiplicateur de la composante santé après un PSE, une RCC ou un accord de maintien dans l'emploi.",
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
  {
    key: "strate.site.icpe",
    value: 5,
    min: 0,
    max: 15,
    labelFr: "Site industriel classé (ICPE)",
    descriptionFr: "Points pour un établissement recensé comme installation classée (Géorisques) : un site de production, pas un bureau.",
  },
  {
    key: "strate.lbb.max",
    value: 15,
    min: 0,
    max: 30,
    labelFr: "Potentiel d'embauche (La Bonne Boîte) : max",
    descriptionFr:
      "Points maximum apportés par le score La Bonne Boîte de France Travail (5 étoiles = plein). 0 quand l'établissement n'y figure pas.",
  },

  // -------------------------------------------------------------- Sismo : poids, demi-vies, noyaux
  ...SIGNAUX.map<WeightDef>((s) => ({
    key: `sismo.poids.${s.type}`,
    value: s.poids,
    min: s.poids < 0 ? -100 : 0,
    max: s.poids < 0 ? 0 : 60,
    labelFr: `Poids : ${s.label}`,
    descriptionFr: s.description,
  })),
  ...SIGNAUX.map<WeightDef>((s) => ({
    key: `sismo.demivie.${s.type}`,
    value: s.demiVie,
    min: 1,
    max: s.demiVie >= 365 ? 730 : 365,
    labelFr: `Demi-vie : ${s.label} (j)`,
    descriptionFr: "Jours après lesquels la contribution du signal est divisée par deux (noyau immédiat, ou décroissance après le pic).",
  })),
  ...SIGNAUX.filter((s) => s.pic != null).flatMap<WeightDef>((s) => [
    {
      key: `sismo.pic.${s.type}`,
      value: s.pic!,
      min: 1,
      max: 720,
      labelFr: `Pic : ${s.label} (j)`,
      descriptionFr:
        "Noyau à retard : nombre de jours après le signal où le besoin de main-d'œuvre est le plus probable (contribution pleine).",
    },
    {
      key: `sismo.largeur.${s.type}`,
      value: s.largeur!,
      min: 0.1,
      max: 2,
      labelFr: `Largeur du pic : ${s.label}`,
      descriptionFr: "Étalement du pic en échelle logarithmique (0.7 ≈ de la moitié au double du pic).",
    },
  ]),
  {
    key: "sismo.plancher_retard",
    value: 0.4,
    min: 0,
    max: 1,
    labelFr: "Noyaux à retard : contribution dès le jour J",
    descriptionFr:
      "Part de la contribution accordée dès la publication d'un signal à retard (avant son pic) : on peut appeler tôt, mais le besoin n'est pas encore là.",
  },

  // -------------------------------------------------------------- Sismo : normalisation, secteur, corroboration
  {
    key: "sismo.norm.midpoint",
    value: 30,
    min: 1,
    max: 100,
    labelFr: "Normalisation : point médian",
    descriptionFr:
      "Somme de contributions donnant un Pouls de 50. La normalisation logistique évite qu'une entreprise à 50 offres écrase le classement.",
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
    key: "sismo.interimabilite.ref",
    value: 0.3,
    min: 0.05,
    max: 1,
    labelFr: "Intérimabilité mesurée : part de missions pour le plein",
    descriptionFr:
      "Pour le métier (ROME) d'une offre, le bassin publie la réponse : la part des annonces de ce métier qui sont des missions d'intérim. À cette part, le signal d'offre pèse à plein ; en dessous, il est réduit proportionnellement. Remplace la liste binaire de métiers cibles, qui ne couvrait que 3 % des offres réelles.",
  },
  {
    key: "sismo.interimabilite.min_obs",
    value: 5,
    min: 1,
    max: 50,
    labelFr: "Intérimabilité mesurée : annonces minimales",
    descriptionFr:
      "Nombre d'annonces (missions + offres directes) observées sur le bassin pour un métier en dessous duquel la mesure se tait et l'intensité du secteur prend le relais.",
  },
  {
    key: "sismo.secteur.plancher",
    value: 0.15,
    min: 0,
    max: 1,
    labelFr: "Intérimabilité : plancher",
    descriptionFr:
      "Les signaux d'offres sont multipliés par l'intérimabilité du besoin — mesurée sur le bassin pour le métier, à défaut l'intensité intérim du secteur (taux / taux de saturation). Ce plancher évite d'annuler totalement un métier ou un secteur à faible recours.",
  },
  {
    key: "sismo.recurrence.jours",
    value: 30,
    min: 7,
    max: 180,
    labelFr: "Récurrence : fenêtre (jours)",
    descriptionFr:
      "Deux déclencheurs qualifiants dans cette fenêtre valent plus que deux déclencheurs à six mois d'écart : c'est la corroboration dans le temps, en plus de la corroboration entre familles de sources.",
  },
  {
    key: "sismo.recurrence.bonus",
    value: 0.15,
    min: 0,
    max: 1,
    labelFr: "Récurrence : bonus par déclencheur supplémentaire",
    descriptionFr:
      "Chaque déclencheur qualifiant distinct au-delà du premier dans la fenêtre de récurrence multiplie la somme par (1 + bonus), jusqu'à trois.",
  },
  {
    key: "sismo.famille.cap",
    value: 40,
    min: 5,
    max: 200,
    labelFr: "Corroboration : plafond par famille de source",
    descriptionFr:
      "Les contributions d'une même famille (offres, commande publique, registre, accords, urbanisme) saturent vers ce plafond : cinq offres d'un même hôpital ne valent pas une offre et un marché.",
  },
  {
    key: "sismo.corroboration.bonus",
    value: 0.25,
    min: 0,
    max: 1,
    labelFr: "Corroboration : bonus par famille supplémentaire",
    descriptionFr:
      "Chaque famille de source positive au-delà de la première multiplie la somme par (1 + bonus). Deux sources indépendantes qui convergent valent plus qu'une source bavarde.",
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
    descriptionFr: "Montant de marché public à partir duquel le poids MARCHE_ATTRIBUE est plein (un marché sans montant connu compte pour 0.6).",
  },
  {
    key: "sismo.marche.dedup_jours",
    value: 60,
    min: 0,
    max: 365,
    labelFr: "Marché : fenêtre de dédoublonnage (j)",
    descriptionFr:
      "Le BOAMP publie l'attribution le jour même, le DECP la republie des semaines plus tard avec son montant. Deux marchés du même titulaire, d'objet proche et distants de moins de ce nombre de jours ne comptent qu'une fois (le plus fort). 0 désactive le dédoublonnage.",
  },
  {
    key: "sismo.marche.dedup_similarite",
    value: 0.55,
    min: 0,
    max: 1,
    labelFr: "Marché : similarité d'objet pour dédoublonner",
    descriptionFr:
      "Similarité minimale entre les objets de deux marchés (trigrammes) pour les considérer comme le même marché. Trop bas, deux chantiers distincts seraient fusionnés.",
  },
  {
    key: "sismo.actualisations.ref",
    value: 3,
    min: 1,
    max: 20,
    labelFr: "Réactualisation : nombre d'actualisations pour le plein",
    descriptionFr: "Nombre d'actualisations d'une même offre chez France Travail à partir duquel OFFRE_REACTUALISEE pèse à plein.",
  },
  {
    key: "sismo.postes.ref",
    value: 5,
    min: 1,
    max: 50,
    labelFr: "Multipostes : nombre de postes pour le plein",
    descriptionFr: "Nombre de postes sur une offre à partir duquel OFFRE_MULTIPOSTES pèse à plein.",
  },

  // -------------------------------------------------------------- Tempo
  {
    key: "tempo.min",
    value: 0.6,
    min: 0.1,
    max: 1,
    labelFr: "Tempo : plancher",
    descriptionFr: "Tempo ordonne les appels dans la semaine, il ne décide pas de la liste : il ne descend jamais sous ce plancher.",
  },
  {
    key: "tempo.max",
    value: 1.4,
    min: 1,
    max: 3,
    labelFr: "Tempo : plafond",
    descriptionFr: "Plafond du facteur Tempo.",
  },
  {
    key: "tempo.saison.amplitude",
    value: 0.2,
    min: 0,
    max: 1,
    labelFr: "Tempo : amplitude de la saisonnalité",
    descriptionFr:
      "Poids de la saisonnalité secteur × mois (calendrier embarqué, part saisonnière BMO du bassin). 0 = ignorer les saisons.",
  },
  {
    key: "tempo.conjoncture.amplitude",
    value: 0.15,
    min: 0,
    max: 1,
    labelFr: "Tempo : amplitude de la conjoncture locale",
    descriptionFr:
      "Poids de la tendance des missions d'intérim publiées sur le bassin pour les métiers du lead (demande prouvée localement).",
  },
  {
    key: "tempo.difficulte.amplitude",
    value: 0.15,
    min: 0,
    max: 1,
    labelFr: "Tempo : amplitude des difficultés de recrutement (BMO)",
    descriptionFr:
      "Poids de la part de projets jugés difficiles par les employeurs du département pour ces métiers (enquête BMO).",
  },
  {
    key: "tempo.commande_publique.amplitude",
    value: 0.1,
    min: 0,
    max: 1,
    labelFr: "Tempo : amplitude des appels d'offres ouverts",
    descriptionFr:
      "Bonus quand des marchés publics portant sur les métiers du lead sont en cours d'attribution sur le bassin : du travail va être commandé, quelqu'un va le gagner.",
  },
  {
    key: "tempo.commande_publique.ref",
    value: 3,
    min: 1,
    max: 50,
    labelFr: "Tempo : appels d'offres pour le plein",
    descriptionFr: "Nombre d'appels d'offres ouverts sur ces métiers à partir duquel le bonus est maximal.",
  },
  {
    key: "tempo.fenetre.amplitude",
    value: 0.2,
    min: 0,
    max: 1,
    labelFr: "Tempo : amplitude de la fenêtre d'appel",
    descriptionFr:
      "Bonus quand la date du jour tombe dans la fenêtre d'appel dérivée des signaux à retard (le chantier va démarrer).",
  },

  // -------------------------------------------------------------- Score final
  {
    key: "final.alpha",
    value: 0.4,
    min: 0,
    max: 2,
    labelFr: "Exposant Socle (α)",
    descriptionFr: "final = 100 × (strate/100)^α × (sismo/100)^β × tempo^γ. Multiplicatif, pas additif.",
  },
  {
    key: "final.beta",
    value: 0.6,
    min: 0,
    max: 2,
    labelFr: "Exposant Pouls (β)",
    descriptionFr: "final = 100 × (strate/100)^α × (sismo/100)^β × tempo^γ. Multiplicatif, pas additif.",
  },
  {
    key: "final.gamma",
    value: 1,
    min: 0,
    max: 2,
    labelFr: "Exposant Tempo (γ)",
    descriptionFr: "Exposant du facteur Tempo dans le score final. 0 = ignorer le quand.",
  },
  {
    key: "final.rayon_max_facteur",
    value: 5,
    min: 1,
    max: 20,
    labelFr: "Portée maximale (× rayon)",
    descriptionFr:
      "Au-delà de ce multiple du rayon de l'agence, l'établissement part en nurturing quel que soit son score : les sources départementales (BODACC, marchés publics) ramènent des sièges de toute la France, et une agence ne place pas d'intérimaires à 300 km. La distance retenue est celle du besoin quand un signal en porte un.",
  },
  {
    key: "final.seuil_chaud",
    value: 15,
    min: 0,
    max: 100,
    labelFr: "Seuil Pouls « lead chaud »",
    descriptionFr:
      "En dessous de ce Pouls, l'entreprise ne peut pas être un lead chaud, quel que soit son Socle : elle reste tiède.",
  },
];

export type WeightMap = Record<string, number>;

export function defaultWeightMap(): WeightMap {
  return Object.fromEntries(WEIGHT_DEFAULTS.map((w) => [w.key, w.value]));
}
