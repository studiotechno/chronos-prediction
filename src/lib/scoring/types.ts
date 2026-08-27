/**
 * Types du moteur de scoring — TS pur, aucune dépendance réseau ni base.
 * Les entrées sont découplées du schéma Drizzle pour rester testables et portables.
 */

export type EtabScoringInput = {
  siret: string;
  siren: string;
  denomination: string;
  naf: string;
  effectifEstime: number | null;
  lat: number | null;
  lon: number | null;
  dateCreation: string | null;
  etatAdministratif: string | null;
  /** Nombre d'établissements du même SIREN présents sur le bassin. */
  nbEtabsBassin: number;
};

export type SignalScoringInput = {
  id: string;
  type: string;
  occurredAt: string;
  confidence: number;
  payload: Record<string, unknown> | null;
};

export type AgenceScoringInput = {
  lat: number;
  lon: number;
  rayonKm: number;
  romeCibles: string[];
};

export type ScoreComponent = {
  key: string;
  labelFr: string;
  contribution: number;
  max?: number;
  detailFr?: string;
};

export type StrateResult = {
  score: number;
  components: ScoreComponent[];
};

export type SignalContribution = {
  id: string;
  type: string;
  occurredAt: string;
  /** Contribution brute (avant normalisation logistique). Négative pour les malus. */
  contribution: number;
};

export type SismoResult = {
  score: number;
  /** Somme brute des contributions avant normalisation logistique. */
  sommeBrute: number;
  /** Contributions agrégées par type de signal (pour les barres de décomposition). */
  components: ScoreComponent[];
  /** Contribution de chaque signal (pour la timeline et top_signals). */
  contributions: SignalContribution[];
};

export type LeadResult = {
  siret: string;
  scoreFinal: number;
  strate: number;
  sismo: number;
  segment: "chaud" | "nurturing";
  raisonFr: string;
  topSignals: {
    id: string;
    type: string;
    occurredAt: string;
    contribution: number;
    resumeFr: string;
  }[];
};

export type WeightMap = Record<string, number>;
