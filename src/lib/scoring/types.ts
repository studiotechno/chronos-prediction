/**
 * Types du moteur de scoring — TS pur, aucune dépendance réseau ni base.
 * Les entrées sont découplées du schéma Drizzle pour rester testables et portables.
 */

export type EtabScoringInput = {
  siret: string;
  siren: string;
  denomination: string;
  naf: string;
  /** Conventions collectives (IDCC) de l'établissement ou, à défaut, de l'entreprise. */
  idcc: string[];
  trancheEffectif: string | null;
  trancheEffectifSource: string | null;
  effectifEstime: number | null;
  /** O / N : l'INSEE sait si l'établissement emploie des salariés. */
  caractereEmployeur: string | null;
  lat: number | null;
  lon: number | null;
  codeInsee: string | null;
  commune: string | null;
  dateCreation: string | null;
  etatAdministratif: string | null;
  /** Nombre d'établissements du même SIREN présents sur le bassin. */
  nbEtabsBassin: number;
  /** Finances du dernier exercice déposé (RNE). */
  ca: number | null;
  caPrecedent: number | null;
  resultatNet: number | null;
  /** Installation classée (Géorisques). */
  icpe: boolean;
  /** Potentiel d'embauche La Bonne Boîte, 0-5. */
  lbbScore: number | null;
};

export type SignalLieu = { lat: number; lon: number; libelle: string | null };

export type SignalScoringInput = {
  id: string;
  type: string;
  occurredAt: string;
  confidence: number;
  payload: Record<string, unknown> | null;
  /** Lieu du besoin (chantier, lieu de travail), quand la source le donne. */
  lieu?: SignalLieu | null;
  /** Métiers ROME induits par le signal. */
  romes?: string[] | null;
};

export type AgenceScoringInput = {
  lat: number;
  lon: number;
  rayonKm: number;
  romeCibles: string[];
  /** Divisions (2 chiffres) ou codes NAF complets exclus du scoring. */
  nafExclus: string[];
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
  /** Distance retenue (lieu du besoin le plus proche, à défaut l'établissement) et son libellé. */
  distanceKm: number | null;
  lieuFr: string | null;
};

export type SignalContribution = {
  id: string;
  type: string;
  occurredAt: string;
  /** Contribution après noyau, facteurs et confiance (avant saturation par famille). Négative pour les malus. */
  contribution: number;
  /** Pour les noyaux à retard : date de pic estimée (ISO). */
  picAt?: string;
};

export type SismoResult = {
  score: number;
  /** Somme après saturation par famille et corroboration, avant normalisation logistique. */
  sommeBrute: number;
  /** Contributions agrégées par type de signal (pour les barres de décomposition). */
  components: ScoreComponent[];
  /** Contribution de chaque signal (pour la timeline et top_signals). */
  contributions: SignalContribution[];
  /** Fenêtre d'appel dérivée des signaux à retard (ISO). Absente = maintenant. */
  fenetre: { debut: string; fin: string } | null;
  /** Métiers ROME induits par les signaux positifs, du plus contributif au moins. */
  romesInduits: string[];
};

export type TempoResult = {
  /** Facteur autour de 1, borné par tempo.min / tempo.max. */
  score: number;
  components: ScoreComponent[];
};

export type LeadResult = {
  siret: string;
  scoreFinal: number;
  strate: number;
  sismo: number;
  tempo: number;
  segment: "chaud" | "nurturing";
  raisonFr: string;
  propositionFr: string | null;
  fenetre: { debut: string; fin: string } | null;
  lieuBesoinFr: string | null;
  distanceBesoinKm: number | null;
  romesInduits: string[];
  topSignals: {
    id: string;
    type: string;
    occurredAt: string;
    contribution: number;
    resumeFr: string;
  }[];
};

export type WeightMap = Record<string, number>;
