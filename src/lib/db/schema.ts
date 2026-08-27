/**
 * Schéma Drizzle — SQLite en V0, conçu pour rester portable vers Postgres :
 * uniquement text / integer / real, timestamps en texte ISO 8601 UTC,
 * JSON en colonnes text (mode json), aucune fonction SQLite dans les défauts.
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Référentiel entreprises / établissements (SIRENE)
// ---------------------------------------------------------------------------

export const entreprise = sqliteTable("entreprise", {
  siren: text("siren").primaryKey(),
  denomination: text("denomination").notNull(),
  categorie: text("categorie"), // PME, ETI, GE...
  dateCreation: text("date_creation"),
  etat: text("etat"), // A (actif) / C (cessé)
});

export const etablissement = sqliteTable(
  "etablissement",
  {
    siret: text("siret").primaryKey(),
    siren: text("siren")
      .notNull()
      .references(() => entreprise.siren),
    denomination: text("denomination").notNull(),
    naf: text("naf").notNull(), // ex: 43.99C
    trancheEffectif: text("tranche_effectif"), // code INSEE (00, 01, 02, 03, 11, 12, 21, 22, 31, 32, 41, 42, 51, 52, 53)
    effectifEstime: integer("effectif_estime"), // point médian de la tranche
    codePostal: text("code_postal"),
    commune: text("commune"),
    lat: real("lat"),
    lon: real("lon"),
    dateCreation: text("date_creation"),
    etatAdministratif: text("etat_administratif"), // A / F
    estSiege: integer("est_siege").notNull().default(0), // booléen 0/1
  },
  (t) => [
    index("etablissement_siren_idx").on(t.siren),
    index("etablissement_naf_idx").on(t.naf),
    index("etablissement_cp_idx").on(t.codePostal),
  ],
);

// ---------------------------------------------------------------------------
// Signaux (dérivées datées, jamais de la donnée brute recopiée)
// ---------------------------------------------------------------------------

export const signal = sqliteTable(
  "signal",
  {
    id: text("id").primaryKey(),
    siret: text("siret"), // nullable : signal en attente de rapprochement, ou signal de bassin (MISSION_CONCURRENT)
    siren: text("siren"),
    type: text("type").notNull(), // OFFRE_DIRECTE, OFFRE_VELOCITE, OFFRE_REPUBLIEE, CDD_COURT_REPETE, MISSION_CONCURRENT, MARCHE_ATTRIBUE, EFFECTIF_UP, BODACC_CAPITAL, BODACC_RISQUE
    source: text("source").notNull(), // francetravail, decp, sirene, bodacc, fixture:*
    occurredAt: text("occurred_at").notNull(), // ISO 8601 UTC
    ingestedAt: text("ingested_at").notNull(),
    confidence: real("confidence").notNull(), // 0..1, fiabilité du rapprochement au SIRET
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    rawRef: text("raw_ref").notNull(), // identifiant chez la source, pour idempotence
  },
  (t) => [
    uniqueIndex("signal_source_rawref_uq").on(t.source, t.rawRef),
    index("signal_siret_idx").on(t.siret),
    index("signal_type_idx").on(t.type),
  ],
);

// ---------------------------------------------------------------------------
// Staging interne : offres brutes France Travail.
// Hors scoring — sert uniquement à calculer les dérivées (vélocité,
// republication, CDD répétés) qui exigent un historique d'offres.
// ---------------------------------------------------------------------------

export const offreBrute = sqliteTable(
  "offre_brute",
  {
    id: text("id").primaryKey(), // id France Travail
    siret: text("siret"),
    entrepriseNom: text("entreprise_nom"),
    intitule: text("intitule").notNull(),
    typeContrat: text("type_contrat"), // CDI, CDD, MIS...
    dureeContratJours: integer("duree_contrat_jours"),
    rome: text("rome"),
    codePostal: text("code_postal"),
    commune: text("commune"),
    parAgenceInterim: integer("par_agence_interim").notNull().default(0),
    datePublication: text("date_publication").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    closedAt: text("closed_at"), // renseigné quand l'offre disparaît de la source
    source: text("source").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    index("offre_siret_idx").on(t.siret),
    index("offre_intitule_idx").on(t.intitule),
  ],
);

// ---------------------------------------------------------------------------
// Poids de scoring — AUCUNE constante magique dans le code
// ---------------------------------------------------------------------------

export const weights = sqliteTable("weights", {
  key: text("key").primaryKey(),
  value: real("value").notNull(),
  min: real("min").notNull(),
  max: real("max").notNull(),
  labelFr: text("label_fr").notNull(),
  descriptionFr: text("description_fr").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export type ScoreComponent = {
  key: string;
  labelFr: string;
  contribution: number;
  max?: number;
  detailFr?: string;
};

export const scoreStrate = sqliteTable("score_strate", {
  siret: text("siret").primaryKey(),
  score: real("score").notNull(),
  components: text("components", { mode: "json" }).$type<ScoreComponent[]>(),
  computedAt: text("computed_at").notNull(),
});

export const scoreSismo = sqliteTable("score_sismo", {
  siret: text("siret").primaryKey(),
  score: real("score").notNull(),
  components: text("components", { mode: "json" }).$type<ScoreComponent[]>(),
  computedAt: text("computed_at").notNull(),
});

export type TopSignal = {
  id: string;
  type: string;
  occurredAt: string;
  contribution: number;
  resumeFr: string;
};

export const lead = sqliteTable(
  "lead",
  {
    siret: text("siret").primaryKey(),
    scoreFinal: real("score_final").notNull(),
    strate: real("strate").notNull(),
    sismo: real("sismo").notNull(),
    statut: text("statut").notNull().default("nouveau"), // nouveau, contacte, qualifie, perdu, gagne
    segment: text("segment").notNull().default("chaud"), // chaud | nurturing
    raisonFr: text("raison_fr").notNull(),
    topSignals: text("top_signals", { mode: "json" }).$type<TopSignal[]>(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [index("lead_segment_idx").on(t.segment)],
);

// ---------------------------------------------------------------------------
// File de rapprochement manuel
// ---------------------------------------------------------------------------

export type CandidatResolution = {
  siret: string;
  denomination: string;
  commune: string | null;
  naf: string | null;
  similarite: number;
};

export const resolutionQueue = sqliteTable("resolution_queue", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  rawDenomination: text("raw_denomination").notNull(),
  rawCodePostal: text("raw_code_postal"),
  rawNaf: text("raw_naf"),
  candidats: text("candidats", { mode: "json" }).$type<CandidatResolution[]>(),
  statut: text("statut").notNull().default("en_attente"), // en_attente, resolu, rejete
  resolvedSiret: text("resolved_siret"),
  signalId: text("signal_id"), // signal à rattacher une fois résolu
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Agence (V0 : mono-agence, première ligne)
// ---------------------------------------------------------------------------

export const agence = sqliteTable("agence", {
  id: text("id").primaryKey(),
  nom: text("nom").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  rayonKm: real("rayon_km").notNull(),
  nafCibles: text("naf_cibles", { mode: "json" }).$type<string[]>(),
  romeCibles: text("rome_cibles", { mode: "json" }).$type<string[]>(),
});

// ---------------------------------------------------------------------------
// Retours CRM — vide en V0, futur dataset supervisé (V2)
// ---------------------------------------------------------------------------

export const crmOutcome = sqliteTable("crm_outcome", {
  id: text("id").primaryKey(),
  siret: text("siret").notNull(),
  evenement: text("evenement").notNull(), // rdv_obtenu, mission_signee, refus, impaye...
  date: text("date").notNull(),
  montant: real("montant"),
});

// ---------------------------------------------------------------------------
// Journal d'ingestion
// ---------------------------------------------------------------------------

export type IngestionError = { message: string; ref?: string };

export const ingestionRun = sqliteTable("ingestion_run", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  recordsIn: integer("records_in").notNull().default(0),
  recordsOut: integer("records_out").notNull().default(0),
  errors: text("errors", { mode: "json" }).$type<IngestionError[]>(),
});
