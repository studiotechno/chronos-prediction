/**
 * Registre des sources de données. L'état de vérification des endpoints
 * est tenu à jour ici ET dans docs/sources.md.
 */

export type EtatEndpoint = "verifie" | "non_verifie" | "embarquee";

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
      "Référentiel des établissements du bassin : SIRET, NAF, tranche d'effectif, coordonnées. API data.gouv.fr ouverte, limitée à 7 req/s.",
    sansCle: true,
    etatEndpoint: "non_verifie",
  },
  {
    id: "francetravail",
    nomFr: "France Travail — Offres d'emploi v2",
    descriptionFr:
      "Offres actives en temps réel. La source la plus importante : ce sont les dérivées qui comptent (republication, vélocité, CDD répétés, missions concurrentes).",
    sansCle: false,
    etatEndpoint: "non_verifie",
    notesFr: "Clé OAuth2 requise — créer un compte sur francetravail.io (voir .env.example).",
  },
  {
    id: "decp",
    nomFr: "DECP — Marchés publics attribués",
    descriptionFr:
      "Données essentielles de la commande publique. Le SIRET du titulaire est généralement présent : pas de rapprochement flou.",
    sansCle: true,
    etatEndpoint: "non_verifie",
  },
  {
    id: "bodacc",
    nomFr: "BODACC — Annonces civiles et commerciales",
    descriptionFr:
      "Procédures collectives (signal négatif fort), augmentations de capital, fusions. API Opendatasoft de la DILA, ouverte.",
    sansCle: true,
    etatEndpoint: "non_verifie",
  },
  {
    id: "dares",
    nomFr: "DARES — Taux de recours à l'intérim",
    descriptionFr:
      "Table de référence par division NAF, embarquée dans le repo (data/reference/). Le multiplicateur qui élimine le bruit sectoriel.",
    sansCle: true,
    etatEndpoint: "embarquee",
    notesFr:
      "Ancrée sur les taux réels par grand secteur (DARES T1 2025) ; ventilation par division approximée, à remplacer (voir docs/sources.md).",
  },
];
