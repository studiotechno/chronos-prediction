/** Interface commune des sources de données. */

export type FetchParams = {
  lat?: number;
  lon?: number;
  rayonKm?: number;
  /** Codes NAF complets (ex: "43.99C"). */
  nafs?: string[];
  depuisJours?: number;
  departement?: string;
};

export type EtablissementRecord = {
  kind: "etablissement";
  entreprise: {
    siren: string;
    denomination: string;
    categorie: string | null;
    dateCreation: string | null;
    etat: string | null;
  };
  etablissement: {
    siret: string;
    siren: string;
    denomination: string;
    naf: string;
    trancheEffectif: string | null;
    effectifEstime: number | null;
    codePostal: string | null;
    commune: string | null;
    lat: number | null;
    lon: number | null;
    dateCreation: string | null;
    etatAdministratif: string | null;
    estSiege: number;
  };
};

export type SignalRecord = {
  kind: "signal";
  signal: {
    siret: string | null;
    siren: string | null;
    type: string;
    source: string;
    occurredAt: string;
    confidence: number;
    payload: Record<string, unknown>;
    rawRef: string;
  };
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
    parAgenceInterim: number;
    datePublication: string;
    source: string;
    payload: Record<string, unknown>;
  };
};

export type NormalizedRecord = EtablissementRecord | SignalRecord | OffreRecord;

export interface SourceAdapter<TRaw> {
  id: string;
  fetch(params: FetchParams): AsyncIterable<TRaw>;
  normalize(raw: TRaw): NormalizedRecord[];
  /** Données de démo, obligatoire. */
  fixture(): TRaw[];
}
