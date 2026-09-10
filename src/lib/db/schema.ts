/**
 * Schéma Drizzle — PostgreSQL (Supabase).
 * Types volontairement sobres : text / integer / double precision / jsonb.
 * Les timestamps restent du texte ISO 8601 UTC (tri lexicographique correct,
 * aucune conversion de fuseau implicite) et les booléens des entiers 0/1,
 * conformément à ce que lit le reste du code.
 *
 * V2 : le référentiel porte ce que l'API Recherche d'entreprises sait vraiment
 * (finances, convention collective, caractère employeur, enseignes), les
 * signaux portent le LIEU DU BESOIN et les métiers induits, les scores gardent
 * un historique quotidien (score_snapshot) et le lead porte sa fenêtre d'appel.
 */
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Référentiel entreprises / établissements (SIRENE + RNE via l'API Recherche)
// ---------------------------------------------------------------------------

export const entreprise = pgTable("entreprise", {
  siren: text("siren").primaryKey(),
  denomination: text("denomination").notNull(),
  categorie: text("categorie"), // PME, ETI, GE...
  dateCreation: text("date_creation"),
  etat: text("etat"), // A (actif) / C (cessé)
  /** O / N : l'unité légale emploie-t-elle des salariés (INSEE). */
  caractereEmployeur: text("caractere_employeur"),
  nbEtabsOuverts: integer("nb_etabs_ouverts"),
  /** Dernier exercice connu (RNE via l'API Recherche) : chiffre d'affaires, résultat net. */
  caAnnee: integer("ca_annee"),
  ca: doublePrecision("ca"),
  caPrecedent: doublePrecision("ca_precedent"),
  resultatNet: doublePrecision("resultat_net"),
  resultatNetPrecedent: doublePrecision("resultat_net_precedent"),
  /** Conventions collectives (IDCC) déclarées en DSN pour l'unité légale. */
  idcc: jsonb("idcc").$type<string[]>(),
  /** Vue rapide de l'API Recherche : est_rge, est_siae, egapro_renseignee… */
  complements: jsonb("complements").$type<Record<string, unknown>>(),
});

export const etablissement = pgTable(
  "etablissement",
  {
    siret: text("siret").primaryKey(),
    siren: text("siren")
      .notNull()
      .references(() => entreprise.siren),
    denomination: text("denomination").notNull(),
    naf: text("naf").notNull(), // ex: 43.99C
    trancheEffectif: text("tranche_effectif"), // code INSEE (00, 01, 02, 03, 11, 12, 21, 22, 31, 32, 41, 42, 51, 52, 53)
    /** D'où vient la tranche retenue : sirene, francetravail (trancheEffectifEtab d'une offre), estimation. */
    trancheEffectifSource: text("tranche_effectif_source"),
    effectifEstime: integer("effectif_estime"), // point médian de la tranche
    codePostal: text("code_postal"),
    commune: text("commune"),
    codeInsee: text("code_insee"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    dateCreation: text("date_creation"),
    dateDebutActivite: text("date_debut_activite"),
    etatAdministratif: text("etat_administratif"), // A / F
    estSiege: integer("est_siege").notNull().default(0), // booléen 0/1
    caractereEmployeur: text("caractere_employeur"),
    enseignes: jsonb("enseignes").$type<string[]>(),
    nomCommercial: text("nom_commercial"),
    idcc: jsonb("idcc").$type<string[]>(),
    /** Installation classée (Géorisques) : 0/1, et son régime (Enregistrement, Autorisation, Déclaration). */
    icpe: integer("icpe").notNull().default(0),
    icpeRegime: text("icpe_regime"),
    /** Potentiel d'embauche La Bonne Boîte (0-5 étoiles) et date de lecture. */
    lbbScore: doublePrecision("lbb_score"),
    lbbMaj: text("lbb_maj"),
  },
  (t) => [
    index("etablissement_siren_idx").on(t.siren),
    index("etablissement_naf_idx").on(t.naf),
    index("etablissement_cp_idx").on(t.codePostal),
    index("etablissement_insee_idx").on(t.codeInsee),
  ],
);

// ---------------------------------------------------------------------------
// Signaux (dérivées datées, jamais de la donnée brute recopiée)
// ---------------------------------------------------------------------------

export type SignalLieu = { lat: number; lon: number; libelle: string | null };

export const signal = pgTable(
  "signal",
  {
    id: text("id").primaryKey(),
    siret: text("siret"), // nullable : signal en attente de rapprochement, ou signal de bassin (MISSION_CONCURRENT, AO_OUVERT)
    siren: text("siren"),
    type: text("type").notNull(), // voir SIGNAL_TYPES dans scoring/weights-defaults.ts
    source: text("source").notNull(), // francetravail, decp, boamp, sirene, bodacc, acco, georisques, fixture:*
    occurredAt: text("occurred_at").notNull(), // ISO 8601 UTC
    ingestedAt: text("ingested_at").notNull(),
    confidence: doublePrecision("confidence").notNull(), // 0..1, fiabilité du rapprochement au SIRET
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    rawRef: text("raw_ref").notNull(), // identifiant chez la source, pour idempotence
    /** Lieu du besoin (chantier, lieu de travail, site) — pas le siège. */
    lieu: jsonb("lieu").$type<SignalLieu>(),
    /** Métiers ROME induits par le signal (offre : son ROME ; marché : par descripteur/CPV). */
    romes: jsonb("romes").$type<string[]>(),
  },
  (t) => [
    uniqueIndex("signal_source_rawref_uq").on(t.source, t.rawRef),
    index("signal_siret_idx").on(t.siret),
    index("signal_siren_idx").on(t.siren),
    index("signal_type_idx").on(t.type),
  ],
);

// ---------------------------------------------------------------------------
// Staging interne : offres brutes France Travail.
// Hors scoring — sert uniquement à calculer les dérivées (vélocité,
// republication, CDD répétés, réactualisation, manque de candidats).
// ---------------------------------------------------------------------------

export const offreBrute = pgTable(
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
    codeInsee: text("code_insee"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    parAgenceInterim: integer("par_agence_interim").notNull().default(0),
    datePublication: text("date_publication").notNull(),
    /** Dernière actualisation vue chez la source, et combien de fois elle a changé. */
    dateActualisation: text("date_actualisation"),
    nbActualisations: integer("nb_actualisations").notNull().default(0),
    nombrePostes: integer("nombre_postes"),
    manqueCandidats: integer("manque_candidats").notNull().default(0),
    /** Tranche d'effectif de l'établissement employeur, telle que publiée par France Travail. */
    trancheEffectifEtab: text("tranche_effectif_etab"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    closedAt: text("closed_at"), // renseigné quand l'offre disparaît de la source
    source: text("source").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("offre_siret_idx").on(t.siret),
    index("offre_intitule_idx").on(t.intitule),
  ],
);

// ---------------------------------------------------------------------------
// Poids de scoring — AUCUNE constante magique dans le code
// ---------------------------------------------------------------------------

export const weights = pgTable("weights", {
  key: text("key").primaryKey(),
  value: doublePrecision("value").notNull(),
  min: doublePrecision("min").notNull(),
  max: doublePrecision("max").notNull(),
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

export const scoreStrate = pgTable("score_strate", {
  siret: text("siret").primaryKey(),
  score: doublePrecision("score").notNull(),
  components: jsonb("components").$type<ScoreComponent[]>(),
  computedAt: text("computed_at").notNull(),
});

export const scoreSismo = pgTable("score_sismo", {
  siret: text("siret").primaryKey(),
  score: doublePrecision("score").notNull(),
  components: jsonb("components").$type<ScoreComponent[]>(),
  computedAt: text("computed_at").notNull(),
});

/** Tempo — le « quand » : facteur autour de 1, avec ses composantes explicables. */
export const scoreTempo = pgTable("score_tempo", {
  siret: text("siret").primaryKey(),
  score: doublePrecision("score").notNull(),
  components: jsonb("components").$type<ScoreComponent[]>(),
  computedAt: text("computed_at").notNull(),
});

export type TopSignal = {
  id: string;
  type: string;
  occurredAt: string;
  contribution: number;
  resumeFr: string;
};

export const lead = pgTable(
  "lead",
  {
    siret: text("siret").primaryKey(),
    scoreFinal: doublePrecision("score_final").notNull(),
    strate: doublePrecision("strate").notNull(),
    sismo: doublePrecision("sismo").notNull(),
    tempo: doublePrecision("tempo").notNull().default(1),
    statut: text("statut").notNull().default("nouveau"), // nouveau, contacte, qualifie, perdu, gagne
    segment: text("segment").notNull().default("chaud"), // chaud | nurturing
    raisonFr: text("raison_fr").notNull(),
    /** Ce qu'on propose au téléphone : métiers induits par les signaux. */
    propositionFr: text("proposition_fr"),
    topSignals: jsonb("top_signals").$type<TopSignal[]>(),
    /** Fenêtre d'appel dérivée des noyaux à retard (ISO dates). Vide = maintenant. */
    fenetreDebut: text("fenetre_debut"),
    fenetreFin: text("fenetre_fin"),
    /** Lieu du besoin le plus proche de l'agence, et sa distance. */
    lieuBesoinFr: text("lieu_besoin_fr"),
    distanceBesoinKm: doublePrecision("distance_besoin_km"),
    romesInduits: jsonb("romes_induits").$type<string[]>(),
    computedAt: text("computed_at").notNull(),
  },
  (t) => [index("lead_segment_idx").on(t.segment)],
);

/**
 * Historique quotidien des scores : la mémoire du moteur. Sans elle, ni
 * backtest, ni tendance, ni « monté de 30 points cette semaine ».
 */
export const scoreSnapshot = pgTable(
  "score_snapshot",
  {
    jour: text("jour").notNull(), // YYYY-MM-DD (UTC)
    siret: text("siret").notNull(),
    strate: doublePrecision("strate").notNull(),
    sismo: doublePrecision("sismo").notNull(),
    tempo: doublePrecision("tempo").notNull(),
    scoreFinal: doublePrecision("score_final").notNull(),
    segment: text("segment").notNull(),
    topTypes: jsonb("top_types").$type<string[]>(),
  },
  (t) => [primaryKey({ columns: [t.jour, t.siret] }), index("snapshot_siret_idx").on(t.siret)],
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

export const resolutionQueue = pgTable("resolution_queue", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  rawDenomination: text("raw_denomination").notNull(),
  rawCodePostal: text("raw_code_postal"),
  rawNaf: text("raw_naf"),
  candidats: jsonb("candidats").$type<CandidatResolution[]>(),
  statut: text("statut").notNull().default("en_attente"), // en_attente, resolu, rejete
  resolvedSiret: text("resolved_siret"),
  signalId: text("signal_id"), // signal à rattacher une fois résolu
  createdAt: text("created_at").notNull(),
});

// ---------------------------------------------------------------------------
// Agence (V0 : mono-agence, première ligne)
//
// La ligne est créée par l'inscription dans l'application (/inscription) :
// son absence est précisément ce qui déclenche l'onboarding. Elle porte à la
// fois l'identité du compte et la zone de prospection — un compte, une zone,
// comme le rayon qui sert au scoring de distance.
// ---------------------------------------------------------------------------

export const agence = pgTable("agence", {
  id: text("id").primaryKey(),
  nom: text("nom").notNull(),
  responsable: text("responsable"),
  email: text("email"),
  /**
   * Lien vers le compte Supabase Auth (`auth.users.id`) autorisé à ouvrir
   * l'outil. Aucun mot de passe ici : Supabase Auth les porte et les hache.
   * Null tant qu'aucun compte n'est rattaché — `npm run compte` le pose.
   */
  authUserId: text("auth_user_id"),
  // Ancrage de la zone : commune choisie à l'inscription (libellé lisible).
  commune: text("commune"),
  codePostal: text("code_postal"),
  departement: text("departement"),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  rayonKm: doublePrecision("rayon_km").notNull(),
  nafCibles: jsonb("naf_cibles").$type<string[]>(),
  romeCibles: jsonb("rome_cibles").$type<string[]>(),
  /** Divisions ou codes NAF exclus du scoring (null = liste par défaut : 78, 84). */
  nafExclus: jsonb("naf_exclus").$type<string[]>(),
  creeLe: text("cree_le"),
});

// ---------------------------------------------------------------------------
// Retours commerciaux — le futur dataset supervisé. Chaque changement de
// statut d'un lead y laisse une ligne avec le score et les signaux du moment.
// ---------------------------------------------------------------------------

export const crmOutcome = pgTable("crm_outcome", {
  id: text("id").primaryKey(),
  siret: text("siret").notNull(),
  evenement: text("evenement").notNull(), // contacte, qualifie, perdu, gagne, rdv_obtenu, mission_signee, refus, impaye...
  date: text("date").notNull(),
  montant: doublePrecision("montant"),
  motif: text("motif"),
  scoreFinal: doublePrecision("score_final"),
  strate: doublePrecision("strate"),
  sismo: doublePrecision("sismo"),
  tempo: doublePrecision("tempo"),
  topTypes: jsonb("top_types").$type<string[]>(),
});

// ---------------------------------------------------------------------------
// Journal d'ingestion
// ---------------------------------------------------------------------------

export type IngestionError = { message: string; ref?: string };

export const ingestionRun = pgTable("ingestion_run", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  recordsIn: integer("records_in").notNull().default(0),
  recordsOut: integer("records_out").notNull().default(0),
  errors: jsonb("errors").$type<IngestionError[]>(),
});
