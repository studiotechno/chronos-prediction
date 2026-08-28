/**
 * Registre des sources de données. L'état de vérification des endpoints
 * est tenu à jour ici ET dans docs/sources.md.
 */

export type EtatEndpoint = "verifie" | "non_verifie" | "embarquee" | "a_autoriser";

export type SourceMeta = {
  id: string;
  nomFr: string;
  descriptionFr: string;
  sansCle: boolean;
  etatEndpoint: EtatEndpoint;
  notesFr?: string;
};

export const SOURCES: SourceMeta[] = [
  {
    id: "sirene",
    nomFr: "SIRENE — Recherche d'entreprises",
    descriptionFr:
      "Référentiel des établissements du bassin : SIRET, NAF, tranche d'effectif, coordonnées — et depuis la V2 : chiffre d'affaires et résultat net (RNE), convention collective (IDCC), caractère employeur, enseignes.",
    sansCle: true,
    etatEndpoint: "verifie",
  },
  {
    id: "francetravail",
    nomFr: "France Travail — Offres d'emploi v2",
    descriptionFr:
      "Offres actives en temps réel. Ce sont les dérivées qui comptent : republication, vélocité, CDD répétés, réactualisation, manque de candidats, multipostes, missions concurrentes.",
    sansCle: false,
    etatEndpoint: "verifie",
    notesFr:
      "Clé OAuth2 requise (francetravail.io). L'API ne publie jamais le SIRET de l'employeur : chaque offre passe par le rapprochement d'entité.",
  },
  {
    id: "boamp",
    nomFr: "BOAMP — Annonces de marchés publics",
    descriptionFr:
      "Avis d'attribution le jour de leur parution (MARCHE_ATTRIBUE, par titulaire) et appels d'offres ouverts sur le bassin (AO_OUVERT, signal de Tempo). API Opendatasoft de la DILA, ouverte.",
    sansCle: true,
    etatEndpoint: "verifie",
    notesFr:
      "Le titulaire est publié en clair, sans SIRET : rapprochement par raison sociale. Le code département y est stocké sans zéro initial (« 3 », pas « 03 »).",
  },
  {
    id: "decp",
    nomFr: "DECP — Marchés publics attribués",
    descriptionFr:
      "Données essentielles de la commande publique : le montant et le CPV du marché, avec le SIRET du titulaire. Arrive après le BOAMP, l'enrichit.",
    sansCle: true,
    etatEndpoint: "verifie",
  },
  {
    id: "bodacc",
    nomFr: "BODACC — Annonces civiles et commerciales",
    descriptionFr:
      "Procédures collectives (signal négatif fort), augmentations de capital, fusions. API Opendatasoft de la DILA, ouverte.",
    sansCle: true,
    etatEndpoint: "verifie",
    notesFr:
      "Signaux au SIREN sur tout le département : les entreprises absentes du référentiel sont récupérées à la demande chez SIRENE.",
  },
  {
    id: "georisques",
    nomFr: "Géorisques — Installations classées (ICPE)",
    descriptionFr:
      "Sites industriels classés autour de l'agence, avec SIRET et régime : un site de production, pas un bureau. Entre dans le Socle.",
    sansCle: true,
    etatEndpoint: "verifie",
  },
  {
    id: "acco",
    nomFr: "ACCO — Accords d'entreprise",
    descriptionFr:
      "Accords déposés par les entreprises (DILA) : heures supplémentaires, modulation, nuit, dimanche = surcharge ; PSE, RCC = restructuration.",
    sansCle: true,
    etatEndpoint: "verifie",
    notesFr:
      "Livraison hebdomadaire nationale (~400 Mo) filtrée sur le département : rare, mais très spécifique.",
  },
  {
    id: "labonneboite",
    nomFr: "France Travail — La Bonne Boîte v2",
    descriptionFr:
      "Potentiel d'embauche par établissement (1 à 5 étoiles), calculé par France Travail sur les DPAE des 12 derniers mois. Feature du Socle.",
    sansCle: false,
    etatEndpoint: "a_autoriser",
    notesFr:
      "Le jeton est délivré avec le scope api_labonneboitev2 mais l'API répond « Invalid scope » : l'accès est conditionné à une autorisation manuelle de France Travail sur l'application.",
  },
  {
    id: "urssaf",
    nomFr: "URSSAF — Effectifs par commune × APE",
    descriptionFr:
      "Volume d'intérim (APE 7820Z) et effectifs par commune et secteur, 2006-2025 : la taille du marché local et sa tendance. Référence pour Tempo.",
    sansCle: true,
    etatEndpoint: "verifie",
  },
  {
    id: "bmo",
    nomFr: "France Travail — Enquête BMO 2026",
    descriptionFr:
      "Par département et famille de métiers : projets de recrutement, part jugée difficile, part saisonnière. Table de référence embarquée (data/reference/).",
    sansCle: true,
    etatEndpoint: "embarquee",
  },
  {
    id: "dares",
    nomFr: "DARES — Taux de recours à l'intérim",
    descriptionFr:
      "Tables de référence embarquées (data/reference/) : par convention collective (IDCC) et, à défaut, par division NAF. Le multiplicateur qui élimine le bruit sectoriel.",
    sansCle: true,
    etatEndpoint: "embarquee",
    notesFr:
      "Ancrées sur les taux réels par grand secteur (DARES T1 2025) ; ventilations approximées, clairement étiquetées dans les fichiers.",
  },
];
