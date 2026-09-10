/** Interface commune des sources de données. */

export type FetchParams = {
  lat?: number;
  lon?: number;
  rayonKm?: number;
  /** Codes NAF complets (ex: "43.99C"). */
  nafs?: string[];
  depuisJours?: number;
  departement?: string;
  /** SIRET / SIREN déjà connus du référentiel — pour les sources nationales qu'on filtre localement (ACCO, LBB). */
  sirets?: string[];
  /** SIREN à interroger nommément (ratios INPI). */
  sirens?: string[];
  /** Métiers ROME cibles de l'agence (La Bonne Boîte interroge par ROME). */
  romes?: string[];
};

export type EntrepriseRecord = {
  siren: string;
  denomination: string;
  categorie: string | null;
  dateCreation: string | null;
  etat: string | null;
  caractereEmployeur?: string | null;
  nbEtabsOuverts?: number | null;
  caAnnee?: number | null;
  ca?: number | null;
  caPrecedent?: number | null;
  resultatNet?: number | null;
  resultatNetPrecedent?: number | null;
  idcc?: string[] | null;
  complements?: Record<string, unknown> | null;
};

export type EtablissementFields = {
  siret: string;
  siren: string;
  denomination: string;
  naf: string;
  trancheEffectif: string | null;
  trancheEffectifSource?: string | null;
  effectifEstime: number | null;
  codePostal: string | null;
  commune: string | null;
  codeInsee?: string | null;
  lat: number | null;
  lon: number | null;
  dateCreation: string | null;
  dateDebutActivite?: string | null;
  etatAdministratif: string | null;
  estSiege: number;
  caractereEmployeur?: string | null;
  enseignes?: string[] | null;
  nomCommercial?: string | null;
  idcc?: string[] | null;
};

export type EtablissementRecord = {
  kind: "etablissement";
  entreprise: EntrepriseRecord;
  etablissement: EtablissementFields;
};

export type SignalLieu = { lat: number; lon: number; libelle: string | null };

export type SignalFields = {
  siret: string | null;
  siren: string | null;
  type: string;
  source: string;
  occurredAt: string;
  confidence: number;
  payload: Record<string, unknown>;
  rawRef: string;
  /** Lieu du besoin, quand la source le donne (chantier, lieu de travail, site). */
  lieu?: SignalLieu | null;
  /** Métiers ROME induits par le signal. */
  romes?: string[] | null;
  /**
   * Raison sociale à rapprocher quand la source ne donne pas de SIRET
   * (titulaire BOAMP). L'exécuteur tente le rapprochement, sinon met en file.
   */
  rapprochement?: { denomination: string; codePostal?: string | null; departement?: string | null; naf?: string | null } | null;
};

export type SignalRecord = {
  kind: "signal";
  signal: SignalFields;
};

export type OffreRecord = {
  kind: "offre";
  offre: {
    id: string;
    siret: string | null;
    entrepriseNom: string | null;
    intitule: string;
    typeContrat: string | null;
    dureeContratJours: number | null;
    rome: string | null;
    codePostal: string | null;
    commune: string | null;
    codeInsee?: string | null;
    lat?: number | null;
    lon?: number | null;
    parAgenceInterim: number;
    datePublication: string;
    dateActualisation?: string | null;
    nombrePostes?: number | null;
    manqueCandidats?: number;
    trancheEffectifEtab?: string | null;
    source: string;
    payload: Record<string, unknown>;
  };
};

/**
 * Attribut d'établissement posé par une source qui ne crée pas de signal :
 * un site classé ICPE (Géorisques), un potentiel d'embauche (La Bonne Boîte).
 * Ignoré si le SIRET n'est pas dans le référentiel.
 */
export type AttributRecord = {
  kind: "attribut";
  siret: string;
  attributs: {
    icpe?: number;
    icpeRegime?: string | null;
    lbbScore?: number | null;
    lbbMaj?: string | null;
    trancheEffectif?: string | null;
    trancheEffectifSource?: string | null;
  };
};

/**
 * Finances d'une unité légale apportées par une source comptable (ratios INPI) :
 * met à jour l'entreprise si elle est connue, et dérive CA_CROISSANCE / CA_BAISSE.
 */
export type FinancesRecord = {
  kind: "finances";
  siren: string;
  source: string;
  finances: {
    caAnnee: number | null;
    ca: number | null;
    caPrecedent: number | null;
    resultatNet: number | null;
    resultatNetPrecedent: number | null;
  };
};

export type NormalizedRecord = EtablissementRecord | SignalRecord | OffreRecord | AttributRecord | FinancesRecord;

export interface SourceAdapter<TRaw> {
  id: string;
  fetch(params: FetchParams): AsyncIterable<TRaw>;
  normalize(raw: TRaw): NormalizedRecord[];
  /** Données de démo, obligatoire. */
  fixture(): TRaw[];
}
