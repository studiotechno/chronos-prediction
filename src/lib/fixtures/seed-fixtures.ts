/**
 * Fixtures réalistes — bassin de Marseille.
 * ~400 établissements, ~1200 signaux, générés déterministiquement (RNG seedé).
 * Les dates sont RELATIVES au moment du seed (J-2, J-15…) pour que la décroissance
 * temporelle produise le même classement crédible dans six mois.
 * Toutes les lignes sont étiquetées fixture : source = 'fixture:<source>' et SIREN en 900xxxxxx.
 */
import { like } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { mulberry32, pick, pickWeighted, randInt, chance, type Rng } from "./rng";
import { trancheByCode, trancheRank, TRANCHES_EFFECTIF } from "../reference/tranches";

export type SeedStats = {
  entreprises: number;
  etablissements: number;
  signaux: number;
  offres: number;
  resolutions: number;
};

const SEED = 20260827;

// ---------------------------------------------------------------------------
// Bassin
// ---------------------------------------------------------------------------

type Commune = { nom: string; cp: string; lat: number; lon: number; poids: number };

const COMMUNES: Commune[] = [
  { nom: "Marseille 1er", cp: "13001", lat: 43.299, lon: 5.382, poids: 4 },
  { nom: "Marseille 2e", cp: "13002", lat: 43.303, lon: 5.365, poids: 5 },
  { nom: "Marseille 8e", cp: "13008", lat: 43.271, lon: 5.383, poids: 4 },
  { nom: "Marseille 10e", cp: "13010", lat: 43.276, lon: 5.421, poids: 5 },
  { nom: "Marseille 11e", cp: "13011", lat: 43.289, lon: 5.475, poids: 7 },
  { nom: "Marseille 13e", cp: "13013", lat: 43.335, lon: 5.412, poids: 5 },
  { nom: "Marseille 14e", cp: "13014", lat: 43.334, lon: 5.381, poids: 7 },
  { nom: "Marseille 15e", cp: "13015", lat: 43.351, lon: 5.355, poids: 7 },
  { nom: "Marseille 16e", cp: "13016", lat: 43.358, lon: 5.318, poids: 4 },
  { nom: "Aubagne", cp: "13400", lat: 43.293, lon: 5.571, poids: 6 },
  { nom: "Gémenos", cp: "13420", lat: 43.297, lon: 5.628, poids: 3 },
  { nom: "La Ciotat", cp: "13600", lat: 43.174, lon: 5.604, poids: 3 },
  { nom: "Vitrolles", cp: "13127", lat: 43.46, lon: 5.248, poids: 6 },
  { nom: "Marignane", cp: "13700", lat: 43.416, lon: 5.214, poids: 4 },
  { nom: "Les Pennes-Mirabeau", cp: "13170", lat: 43.41, lon: 5.31, poids: 3 },
  { nom: "Châteauneuf-les-Martigues", cp: "13220", lat: 43.383, lon: 5.164, poids: 2 },
  { nom: "Martigues", cp: "13500", lat: 43.405, lon: 5.048, poids: 3 },
  { nom: "Fos-sur-Mer", cp: "13270", lat: 43.437, lon: 4.944, poids: 3 },
  { nom: "Gardanne", cp: "13120", lat: 43.455, lon: 5.469, poids: 3 },
  { nom: "Aix-en-Provence", cp: "13090", lat: 43.529, lon: 5.447, poids: 4 },
  { nom: "Salon-de-Provence", cp: "13300", lat: 43.64, lon: 5.097, poids: 1 },
];

const communeByNom = new Map(COMMUNES.map((c) => [c.nom, c]));

// ---------------------------------------------------------------------------
// Secteurs
// ---------------------------------------------------------------------------

type OffreType = { intitule: string; rome: string };

type Secteur = {
  id: string;
  poids: number;
  nafs: string[];
  activites: string[];
  offres: OffreType[];
  /** [code tranche, poids] */
  tranches: readonly (readonly [string, number])[];
};

const GEO = [
  "PROVENCE", "PHOCÉEN", "MASSILIA", "SUD", "AZUR", "MÉDITERRANÉE", "GARLABAN",
  "CALANQUES", "HUVEAUNE", "MISTRAL", "ÉTOILE", "PRADO", "LUBERON", "CAMARGUE", "VENTOUX",
];

const SECTEURS: Secteur[] = [
  {
    id: "btp",
    poids: 24,
    nafs: ["41.20A", "41.20B", "42.11Z", "43.12A", "43.22B", "43.32A", "43.34Z", "43.99C", "16.23Z"],
    activites: ["BÂTIMENT", "CONSTRUCTION", "TRAVAUX", "MAÇONNERIE", "RÉNOVATION", "FAÇADES", "CHARPENTE", "ÉTANCHÉITÉ", "TP"],
    offres: [
      { intitule: "Maçon (H/F)", rome: "F1703" },
      { intitule: "Coffreur bancheur (H/F)", rome: "F1701" },
      { intitule: "Manœuvre BTP (H/F)", rome: "F1704" },
      { intitule: "Conducteur d'engins de chantier (H/F)", rome: "F1302" },
      { intitule: "Électricien bâtiment (H/F)", rome: "F1602" },
      { intitule: "Plombier chauffagiste (H/F)", rome: "F1603" },
      { intitule: "Menuisier poseur (H/F)", rome: "F1607" },
    ],
    tranches: [["03", 15], ["11", 30], ["12", 30], ["21", 15], ["22", 8], ["31", 2]],
  },
  {
    id: "transport",
    poids: 12,
    nafs: ["49.41A", "49.41B", "52.29A", "52.29B", "53.20Z"],
    activites: ["TRANSPORTS", "MESSAGERIE", "AFFRÈTEMENT", "FRET", "LIVRAISON"],
    offres: [
      { intitule: "Conducteur SPL (H/F)", rome: "N4101" },
      { intitule: "Conducteur PL (H/F)", rome: "N4101" },
      { intitule: "Chauffeur-livreur (H/F)", rome: "N4105" },
    ],
    tranches: [["03", 10], ["11", 25], ["12", 35], ["21", 18], ["22", 10], ["31", 2]],
  },
  {
    id: "logistique",
    poids: 10,
    nafs: ["52.10B", "82.92Z"],
    activites: ["LOGISTIQUE", "ENTREPOSAGE", "STOCKAGE", "DISTRIBUTION"],
    offres: [
      { intitule: "Cariste CACES 1-3-5 (H/F)", rome: "N1101" },
      { intitule: "Préparateur de commandes (H/F)", rome: "N1103" },
      { intitule: "Agent de quai (H/F)", rome: "N1105" },
      { intitule: "Magasinier (H/F)", rome: "N1103" },
    ],
    tranches: [["11", 15], ["12", 30], ["21", 25], ["22", 20], ["31", 7], ["32", 3]],
  },
  {
    id: "industrie",
    poids: 15,
    nafs: ["25.11Z", "25.62B", "28.22Z", "24.33Z", "22.22Z", "29.32Z", "33.12Z", "20.30Z"],
    activites: ["MÉTALLERIE", "MÉCANIQUE", "CHAUDRONNERIE", "INDUSTRIE", "PLASTURGIE", "USINAGE"],
    offres: [
      { intitule: "Soudeur (H/F)", rome: "H2913" },
      { intitule: "Chaudronnier (H/F)", rome: "H2902" },
      { intitule: "Opérateur de production (H/F)", rome: "H3302" },
      { intitule: "Technicien de maintenance (H/F)", rome: "I1304" },
    ],
    tranches: [["03", 10], ["11", 25], ["12", 30], ["21", 20], ["22", 10], ["31", 5]],
  },
  {
    id: "agro",
    poids: 7,
    nafs: ["10.13A", "10.39A", "10.71C", "56.21Z"],
    activites: ["SALAISONS", "CONSERVES", "FOURNIL", "TRAITEUR", "AGROALIMENTAIRE"],
    offres: [
      { intitule: "Ouvrier agroalimentaire (H/F)", rome: "H2102" },
      { intitule: "Conducteur de ligne (H/F)", rome: "H2102" },
    ],
    tranches: [["03", 15], ["11", 30], ["12", 30], ["21", 15], ["22", 10]],
  },
  {
    id: "proprete",
    poids: 8,
    nafs: ["81.21Z", "81.22Z", "38.11Z"],
    activites: ["NETTOYAGE", "PROPRETÉ", "SERVICES", "HYGIÈNE"],
    offres: [
      { intitule: "Agent de propreté (H/F)", rome: "K2204" },
      { intitule: "Laveur de vitres (H/F)", rome: "K2202" },
    ],
    tranches: [["03", 15], ["11", 25], ["12", 30], ["21", 20], ["22", 10]],
  },
  {
    id: "tertiaire",
    poids: 24,
    nafs: ["62.02A", "70.22Z", "69.20Z", "71.12B", "46.90Z", "47.11F", "45.20A"],
    activites: ["CONSEIL", "DIGITAL", "EXPERTISE", "GESTION", "SOLUTIONS", "INGÉNIERIE"],
    offres: [
      { intitule: "Consultant en organisation (H/F)", rome: "M1402" },
      { intitule: "Développeur full-stack (H/F)", rome: "M1805" },
      { intitule: "Comptable (H/F)", rome: "M1203" },
      { intitule: "Assistant commercial (H/F)", rome: "D1401" },
    ],
    tranches: [["02", 20], ["03", 20], ["11", 25], ["12", 20], ["21", 10], ["22", 5]],
  },
];

const AGENCES_INTERIM = ["Adecco", "Manpower", "Randstad", "Proman", "Crit", "Synergie", "Actual", "Temporis"];

const ACHETEURS_PUBLICS = [
  "Métropole Aix-Marseille-Provence",
  "Ville de Marseille",
  "Département des Bouches-du-Rhône",
  "Grand Port Maritime de Marseille",
  "Ville d'Aubagne",
  "Habitat Marseille Provence",
];

const OBJETS_MARCHE: Record<string, { objet: string; cpv: string }[]> = {
  btp: [
    { objet: "Réfection de chaussées et trottoirs", cpv: "45233140-2" },
    { objet: "Extension du groupe scolaire", cpv: "45214200-2" },
    { objet: "Réhabilitation de logements sociaux", cpv: "45211000-9" },
    { objet: "Rénovation énergétique de bâtiments publics", cpv: "45321000-3" },
  ],
  proprete: [
    { objet: "Nettoyage des locaux administratifs", cpv: "90911200-8" },
    { objet: "Entretien des espaces verts", cpv: "77310000-6" },
  ],
  transport: [
    { objet: "Transport scolaire et périscolaire", cpv: "60130000-8" },
    { objet: "Collecte et transport de déchets", cpv: "90512000-9" },
  ],
  logistique: [{ objet: "Prestations logistiques et magasinage", cpv: "63120000-6" }],
};

// ---------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------

type EtabFixture = {
  siret: string;
  siren: string;
  denomination: string;
  naf: string;
  trancheEffectif: string;
  effectifEstime: number;
  codePostal: string;
  commune: string;
  lat: number;
  lon: number;
  dateCreation: string;
  etatAdministratif: string;
  estSiege: number;
  secteurId: string;
};

export function seedFixtures(db: BetterSQLite3Database<typeof schema>): SeedStats {
  const rng = mulberry32(SEED);
  const now = new Date();
  const nowIso = now.toISOString();
  const iso = (joursAvant: number, heures = 0) =>
    new Date(now.getTime() - (joursAvant * 24 + heures) * 3600 * 1000).toISOString();

  let sigCounter = 0;
  let offreCounter = 0;

  const entreprises: (typeof schema.entreprise.$inferInsert)[] = [];
  const etabs: EtabFixture[] = [];
  const signaux: (typeof schema.signal.$inferInsert)[] = [];
  const offres: (typeof schema.offreBrute.$inferInsert)[] = [];
  const resolutions: (typeof schema.resolutionQueue.$inferInsert)[] = [];

  const nomsUtilises = new Set<string>();

  function nomEntreprise(secteur: Secteur): string {
    for (let essai = 0; essai < 20; essai++) {
      const geo = pick(rng, GEO);
      const act = pick(rng, secteur.activites);
      const nom = chance(rng, 0.5) ? `${act} ${geo}` : `${geo} ${act}`;
      if (!nomsUtilises.has(nom)) {
        nomsUtilises.add(nom);
        return nom;
      }
    }
    const nom = `${pick(rng, secteur.activites)} ${pick(rng, GEO)} ${randInt(rng, 2, 99)}`;
    nomsUtilises.add(nom);
    return nom;
  }

  function jitter(v: number): number {
    return v + (rng() - 0.5) * 0.03;
  }

  function dateCreationAleatoire(): string {
    const annee = randInt(rng, 1985, 2023);
    return `${annee}-${String(randInt(rng, 1, 12)).padStart(2, "0")}-${String(randInt(rng, 1, 28)).padStart(2, "0")}`;
  }

  function ajouteEtab(args: {
    siren: string;
    nic: string;
    denomination: string;
    naf: string;
    tranche: string;
    commune: Commune;
    dateCreation: string;
    secteurId: string;
    estSiege?: boolean;
    etat?: string;
  }): EtabFixture {
    const t = trancheByCode(args.tranche)!;
    const etab: EtabFixture = {
      siret: args.siren + args.nic,
      siren: args.siren,
      denomination: args.denomination,
      naf: args.naf,
      trancheEffectif: args.tranche,
      effectifEstime: t.midpoint,
      codePostal: args.commune.cp,
      commune: args.commune.nom,
      lat: jitter(args.commune.lat),
      lon: jitter(args.commune.lon),
      dateCreation: args.dateCreation,
      etatAdministratif: args.etat ?? "A",
      estSiege: args.estSiege === false ? 0 : 1,
      secteurId: args.secteurId,
    };
    etabs.push(etab);
    return etab;
  }

  function ajouteSignal(args: {
    siret: string | null;
    siren: string | null;
    type: string;
    source: string;
    occurredAt: string;
    confidence: number;
    payload: Record<string, unknown>;
  }): typeof schema.signal.$inferInsert {
    sigCounter++;
    const s: typeof schema.signal.$inferInsert = {
      id: `fx-sig-${String(sigCounter).padStart(5, "0")}`,
      siret: args.siret,
      siren: args.siren,
      type: args.type,
      source: args.source,
      occurredAt: args.occurredAt,
      ingestedAt: nowIso,
      confidence: Math.round(args.confidence * 100) / 100,
      payload: args.payload,
      rawRef: `fx-${String(sigCounter).padStart(5, "0")}`,
    };
    signaux.push(s);
    return s;
  }

  function ajouteOffre(args: {
    siret: string | null;
    entrepriseNom: string;
    intitule: string;
    rome: string;
    typeContrat: string;
    dureeJours?: number | null;
    commune: Commune;
    parAgence?: boolean;
    publieeIlYaJours: number;
    closeIlYaJours?: number | null;
  }) {
    offreCounter++;
    offres.push({
      id: `fx-offre-${String(offreCounter).padStart(5, "0")}`,
      siret: args.siret,
      entrepriseNom: args.entrepriseNom,
      intitule: args.intitule,
      typeContrat: args.typeContrat,
      dureeContratJours: args.dureeJours ?? null,
      rome: args.rome,
      codePostal: args.commune.cp,
      commune: args.commune.nom,
      parAgenceInterim: args.parAgence ? 1 : 0,
      datePublication: iso(args.publieeIlYaJours),
      firstSeenAt: iso(args.publieeIlYaJours),
      lastSeenAt: args.closeIlYaJours != null ? iso(args.closeIlYaJours) : nowIso,
      closedAt: args.closeIlYaJours != null ? iso(args.closeIlYaJours) : null,
      source: "fixture:francetravail",
      payload: {},
    });
  }

  const confFt = () => 0.8 + rng() * 0.19;

  // -------------------------------------------------------------------------
  // Personas — le test de bon sens du classement
  // -------------------------------------------------------------------------

  // P1 — PME du BTP qui republie ses offres et vient de gagner un marché → tête de classement
  const p1Commune = communeByNom.get("Aubagne")!;
  const p1 = ajouteEtab({
    siren: "900100001",
    nic: "00011",
    denomination: "BÂTIR PROVENCE",
    naf: "43.99C",
    tranche: "21",
    commune: p1Commune,
    dateCreation: "2009-04-14",
    secteurId: "btp",
  });
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "OFFRE_REPUBLIEE",
    source: "fixture:francetravail",
    occurredAt: iso(15),
    confidence: 0.95,
    payload: {
      intitule: "Cariste CACES 3 (H/F)",
      rome: "N1101",
      nbRepublications: 3,
      premierePublication: iso(52),
    },
  });
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "MARCHE_ATTRIBUE",
    source: "fixture:decp",
    occurredAt: iso(24),
    confidence: 1,
    payload: {
      objet: "Réhabilitation de voirie — quartier de la Soude",
      montant: 480000,
      acheteur: "Métropole Aix-Marseille-Provence",
      cpv: "45233140-2",
    },
  });
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "OFFRE_DIRECTE",
    source: "fixture:francetravail",
    occurredAt: iso(6),
    confidence: 0.92,
    payload: { intitule: "Maçon VRD (H/F)", rome: "F1702", typeContrat: "CDI" },
  });
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "OFFRE_DIRECTE",
    source: "fixture:francetravail",
    occurredAt: iso(41),
    confidence: 0.92,
    payload: { intitule: "Coffreur bancheur (H/F)", rome: "F1701", typeContrat: "CDD" },
  });
  for (const [pub, close] of [
    [52, 38],
    [36, 22],
    [15, null],
  ] as const) {
    ajouteOffre({
      siret: p1.siret,
      entrepriseNom: p1.denomination,
      intitule: "Cariste CACES 3 (H/F)",
      rome: "N1101",
      typeContrat: "CDI",
      commune: p1Commune,
      publieeIlYaJours: pub,
      closeIlYaJours: close,
    });
  }
  ajouteOffre({
    siret: p1.siret,
    entrepriseNom: p1.denomination,
    intitule: "Maçon VRD (H/F)",
    rome: "F1702",
    typeContrat: "CDI",
    commune: p1Commune,
    publieeIlYaJours: 6,
  });

  // P2 — logistique en croissance d'effectif → tête de classement
  const p2Commune = communeByNom.get("Vitrolles")!;
  const p2 = ajouteEtab({
    siren: "900100002",
    nic: "00011",
    denomination: "LOGISUD DISTRIBUTION",
    naf: "52.10B",
    tranche: "22",
    commune: p2Commune,
    dateCreation: "2012-09-03",
    secteurId: "logistique",
  });
  ajouteSignal({
    siret: p2.siret,
    siren: p2.siren,
    type: "EFFECTIF_UP",
    source: "fixture:sirene",
    occurredAt: iso(35),
    confidence: 1,
    payload: { trancheAvant: "21", trancheApres: "22" },
  });
  ajouteSignal({
    siret: p2.siret,
    siren: p2.siren,
    type: "OFFRE_VELOCITE",
    source: "fixture:francetravail",
    occurredAt: iso(8),
    confidence: 0.9,
    payload: { nbOffres14j: 6, baselineMoyenne: 1.2, ecartsTypes: 3.4 },
  });
  ajouteSignal({
    siret: p2.siret,
    siren: p2.siren,
    type: "CDD_COURT_REPETE",
    source: "fixture:francetravail",
    occurredAt: iso(12),
    confidence: 0.9,
    payload: { nbCdd: 4, fenetreJours: 60, dureeMoyenneJours: 45 },
  });
  ajouteSignal({
    siret: p2.siret,
    siren: p2.siren,
    type: "OFFRE_DIRECTE",
    source: "fixture:francetravail",
    occurredAt: iso(4),
    confidence: 0.94,
    payload: { intitule: "Préparateur de commandes (H/F)", rome: "N1103", typeContrat: "CDD" },
  });
  for (const j of [4, 7, 9, 11, 13, 16]) {
    ajouteOffre({
      siret: p2.siret,
      entrepriseNom: p2.denomination,
      intitule: pick(rng, ["Préparateur de commandes (H/F)", "Cariste CACES 1-3-5 (H/F)", "Agent de quai (H/F)"]),
      rome: pick(rng, ["N1103", "N1101", "N1105"]),
      typeContrat: chance(rng, 0.6) ? "CDD" : "CDI",
      dureeJours: chance(rng, 0.6) ? randInt(rng, 30, 80) : null,
      commune: p2Commune,
      publieeIlYaJours: j,
    });
  }

  // P3 — bon fit structurel mais redressement judiciaire → bas de classement
  const p3Commune = communeByNom.get("Marseille 11e")!;
  const p3 = ajouteEtab({
    siren: "900100003",
    nic: "00011",
    denomination: "MÉTALLERIE PHOCÉENNE",
    naf: "25.11Z",
    tranche: "21",
    commune: p3Commune,
    dateCreation: "1998-01-20",
    secteurId: "industrie",
  });
  ajouteSignal({
    siret: p3.siret,
    siren: p3.siren,
    type: "BODACC_RISQUE",
    source: "fixture:bodacc",
    occurredAt: iso(30),
    confidence: 1,
    payload: { procedure: "redressement judiciaire", tribunal: "Tribunal de commerce de Marseille" },
  });
  ajouteSignal({
    siret: p3.siret,
    siren: p3.siren,
    type: "OFFRE_DIRECTE",
    source: "fixture:francetravail",
    occurredAt: iso(10),
    confidence: 0.9,
    payload: { intitule: "Soudeur (H/F)", rome: "H2913", typeContrat: "CDI" },
  });

  // P4 — cabinet de conseil qui poste 4 offres → neutralisé par la table DARES et les ROME hors cible
  const p4Commune = communeByNom.get("Marseille 8e")!;
  const p4 = ajouteEtab({
    siren: "900100004",
    nic: "00011",
    denomination: "CONSEIL AZUR STRATÉGIE",
    naf: "70.22Z",
    tranche: "12",
    commune: p4Commune,
    dateCreation: "2015-06-11",
    secteurId: "tertiaire",
  });
  for (const [j, intitule, rome] of [
    [3, "Consultant senior (H/F)", "M1402"],
    [9, "Consultant en organisation (H/F)", "M1402"],
    [14, "Chef de projet transformation (H/F)", "M1402"],
    [19, "Data analyst (H/F)", "M1805"],
  ] as const) {
    ajouteSignal({
      siret: p4.siret,
      siren: p4.siren,
      type: "OFFRE_DIRECTE",
      source: "fixture:francetravail",
      occurredAt: iso(j),
      confidence: 0.88,
      payload: { intitule, rome, typeContrat: "CDI" },
    });
    ajouteOffre({
      siret: p4.siret,
      entrepriseNom: p4.denomination,
      intitule,
      rome,
      typeContrat: "CDI",
      commune: p4Commune,
      publieeIlYaJours: j,
    });
  }

  // -------------------------------------------------------------------------
  // Volume : ~396 établissements générés
  // -------------------------------------------------------------------------

  const NB_BULK = 396;
  const secteurEntries = SECTEURS.map((s) => [s, s.poids] as const);

  for (let i = 1; i <= NB_BULK; i++) {
    const secteur = pickWeighted(rng, secteurEntries);
    const commune = pickWeighted(rng, COMMUNES.map((c) => [c, c.poids] as const));
    const siren = String(900200000 + i);
    const nom = nomEntreprise(secteur);
    const tranche = pickWeighted(rng, secteur.tranches);
    const naf = pick(rng, secteur.nafs);
    const ferme = chance(rng, 0.012);

    const etab = ajouteEtab({
      siren,
      nic: "00011",
      denomination: nom,
      naf,
      tranche,
      commune,
      dateCreation: dateCreationAleatoire(),
      secteurId: secteur.id,
      etat: ferme ? "F" : "A",
    });

    // ~1 siren sur 33 a un second établissement sur le bassin (bonus multi-étab)
    if (i % 33 === 0 && !ferme) {
      const commune2 = pickWeighted(rng, COMMUNES.map((c) => [c, c.poids] as const));
      ajouteEtab({
        siren,
        nic: "00025",
        denomination: nom,
        naf,
        tranche: pickWeighted(rng, secteur.tranches),
        commune: commune2,
        dateCreation: dateCreationAleatoire(),
        secteurId: secteur.id,
        estSiege: false,
      });
    }

    if (ferme) continue;

    // ----- Signaux de cet établissement
    const estCible = secteur.id !== "tertiaire";
    if (!chance(rng, estCible ? 0.85 : 0.3)) continue;

    const ageRecent = (echelle: number) =>
      Math.min(150, Math.floor(-Math.log(1 - rng()) * echelle));

    // Entreprise en difficulté : malus BODACC_RISQUE
    if (chance(rng, 0.025)) {
      ajouteSignal({
        siret: etab.siret,
        siren,
        type: "BODACC_RISQUE",
        source: "fixture:bodacc",
        occurredAt: iso(randInt(rng, 10, 120)),
        confidence: 1,
        payload: {
          procedure: pick(rng, ["redressement judiciaire", "procédure de sauvegarde", "liquidation judiciaire"]),
          tribunal: "Tribunal de commerce de Marseille",
        },
      });
    }

    const nbSignaux = estCible
      ? pickWeighted(rng, [
          [1, 12],
          [2, 20],
          [3, 22],
          [4, 17],
          [5, 12],
          [6, 7],
        ] as const)
      : randInt(rng, 1, 2);
    for (let k = 0; k < nbSignaux; k++) {
      const type = estCible
        ? pickWeighted(rng, [
            ["OFFRE_DIRECTE", 48],
            ["CDD_COURT_REPETE", 12],
            ["OFFRE_REPUBLIEE", 8],
            ["OFFRE_VELOCITE", 5],
            ["MARCHE_ATTRIBUE", 6],
            ["EFFECTIF_UP", 8],
            ["BODACC_CAPITAL", 6],
          ] as const)
        : pickWeighted(rng, [
            ["OFFRE_DIRECTE", 75],
            ["EFFECTIF_UP", 13],
            ["BODACC_CAPITAL", 12],
          ] as const);

      if (type === "OFFRE_DIRECTE") {
        const offre = pick(rng, secteur.offres);
        const j = ageRecent(35);
        const cdd = chance(rng, 0.4);
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:francetravail",
          occurredAt: iso(j, randInt(rng, 0, 12)),
          confidence: confFt(),
          payload: { intitule: offre.intitule, rome: offre.rome, typeContrat: cdd ? "CDD" : "CDI" },
        });
        ajouteOffre({
          siret: etab.siret,
          entrepriseNom: nom,
          intitule: offre.intitule,
          rome: offre.rome,
          typeContrat: cdd ? "CDD" : "CDI",
          dureeJours: cdd ? randInt(rng, 30, 180) : null,
          commune,
          publieeIlYaJours: j,
        });
      } else if (type === "OFFRE_REPUBLIEE") {
        const offre = pick(rng, secteur.offres);
        const j = ageRecent(30);
        const nbRepub = randInt(rng, 2, 4);
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:francetravail",
          occurredAt: iso(j),
          confidence: confFt(),
          payload: {
            intitule: offre.intitule,
            rome: offre.rome,
            nbRepublications: nbRepub,
            premierePublication: iso(j + nbRepub * 18),
          },
        });
        for (let r = 0; r < nbRepub; r++) {
          const pub = j + r * 18;
          ajouteOffre({
            siret: etab.siret,
            entrepriseNom: nom,
            intitule: offre.intitule,
            rome: offre.rome,
            typeContrat: "CDI",
            commune,
            publieeIlYaJours: pub,
            closeIlYaJours: r === 0 ? null : pub - randInt(rng, 10, 15),
          });
        }
      } else if (type === "OFFRE_VELOCITE") {
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:francetravail",
          occurredAt: iso(ageRecent(20)),
          confidence: confFt(),
          payload: {
            nbOffres14j: randInt(rng, 4, 9),
            baselineMoyenne: Math.round(rng() * 20) / 10,
            ecartsTypes: Math.round((2 + rng() * 2.5) * 10) / 10,
          },
        });
      } else if (type === "CDD_COURT_REPETE") {
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:francetravail",
          occurredAt: iso(ageRecent(40)),
          confidence: confFt(),
          payload: {
            nbCdd: randInt(rng, 3, 6),
            fenetreJours: 60,
            dureeMoyenneJours: randInt(rng, 20, 80),
          },
        });
      } else if (type === "MARCHE_ATTRIBUE") {
        const objets = OBJETS_MARCHE[secteur.id] ?? OBJETS_MARCHE.btp;
        const marche = pick(rng, objets);
        // montants log-uniformes entre 40 k€ et 600 k€
        const montant = Math.round(Math.exp(Math.log(40000) + rng() * (Math.log(600000) - Math.log(40000))) / 1000) * 1000;
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:decp",
          occurredAt: iso(randInt(rng, 5, 85)),
          confidence: 1,
          payload: { objet: marche.objet, montant, acheteur: pick(rng, ACHETEURS_PUBLICS), cpv: marche.cpv },
        });
      } else if (type === "EFFECTIF_UP") {
        const rank = trancheRank(etab.trancheEffectif);
        if (rank <= 0) continue;
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:sirene",
          occurredAt: iso(randInt(rng, 20, 140)),
          confidence: 1,
          payload: {
            trancheAvant: TRANCHES_EFFECTIF[rank - 1].code,
            trancheApres: etab.trancheEffectif,
          },
        });
      } else if (type === "BODACC_CAPITAL") {
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:bodacc",
          occurredAt: iso(randInt(rng, 10, 100)),
          confidence: 1,
          payload: {
            typeAnnonce: chance(rng, 0.8) ? "augmentation_capital" : "fusion",
            detail: `Capital porté à ${randInt(rng, 100, 2000)} 000 €`,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // MISSION_CONCURRENT : missions d'intérim postées par des agences sur le bassin
  // (siret NULL — alimente la carte de couverture, ne score aucune entreprise)
  // -------------------------------------------------------------------------

  const offresCiblees = SECTEURS.filter((s) => s.id !== "tertiaire").flatMap((s) =>
    s.offres.map((o) => [o, s.poids] as const),
  );
  for (let m = 0; m < 240; m++) {
    const commune = pickWeighted(rng, COMMUNES.map((c) => [c, c.poids] as const));
    const offre = pickWeighted(rng, offresCiblees);
    const agenceNom = pick(rng, AGENCES_INTERIM);
    const j = ageRecent130(rng);
    ajouteSignal({
      siret: null,
      siren: null,
      type: "MISSION_CONCURRENT",
      source: "fixture:francetravail",
      occurredAt: iso(j, randInt(rng, 0, 12)),
      confidence: 1,
      payload: {
        intitule: offre.intitule,
        rome: offre.rome,
        commune: commune.nom,
        codePostal: commune.cp,
        agenceInterim: agenceNom,
      },
    });
    ajouteOffre({
      siret: null,
      entrepriseNom: agenceNom,
      intitule: offre.intitule,
      rome: offre.rome,
      typeContrat: "MIS",
      dureeJours: randInt(rng, 5, 90),
      commune,
      parAgence: true,
      publieeIlYaJours: j,
    });
  }

  function ageRecent130(r: Rng): number {
    return Math.min(60, Math.floor(-Math.log(1 - r()) * 22));
  }

  // -------------------------------------------------------------------------
  // File de résolution : rapprochements ambigus (similarité entre 0.62 et 0.88)
  // -------------------------------------------------------------------------

  const bulkActifs = etabs.filter((e) => e.etatAdministratif === "A" && e.siren.startsWith("9002"));
  for (let q = 0; q < 8; q++) {
    const cible = bulkActifs[(q * 37 + 11) % bulkActifs.length];
    const variantes = [
      `STE ${cible.denomination}`,
      cible.denomination.split(" ").reverse().join(" "),
      `${cible.denomination.split(" ")[0]} ${pick(rng, ["SERVICES", "GROUPE", "13"])}`,
      cible.denomination.replace("É", "E").replace(" ", "-"),
    ];
    const rawDenomination = variantes[q % variantes.length];
    const secteur = SECTEURS.find((s) => s.id === cible.secteurId)!;
    const offre = pick(rng, secteur.offres);

    const pending = ajouteSignal({
      siret: null,
      siren: null,
      type: "OFFRE_DIRECTE",
      source: "fixture:francetravail",
      occurredAt: iso(randInt(rng, 1, 20)),
      confidence: 0.7,
      payload: { intitule: offre.intitule, rome: offre.rome, typeContrat: "CDI", entrepriseNom: rawDenomination },
    });

    const autres = [bulkActifs[(q * 53 + 101) % bulkActifs.length], bulkActifs[(q * 71 + 211) % bulkActifs.length]];
    const candidats = [
      {
        siret: cible.siret,
        denomination: cible.denomination,
        commune: cible.commune,
        naf: cible.naf,
        similarite: Math.round((0.72 + rng() * 0.14) * 100) / 100,
      },
      ...autres.map((a) => ({
        siret: a.siret,
        denomination: a.denomination,
        commune: a.commune,
        naf: a.naf,
        similarite: Math.round((0.62 + rng() * 0.09) * 100) / 100,
      })),
    ].sort((a, b) => b.similarite - a.similarite);

    resolutions.push({
      id: `fx-res-${q + 1}`,
      source: "fixture:francetravail",
      rawDenomination,
      rawCodePostal: cible.codePostal,
      rawNaf: null,
      candidats,
      statut: "en_attente",
      resolvedSiret: null,
      signalId: pending.id,
      createdAt: iso(randInt(rng, 0, 5)),
    });
  }

  // -------------------------------------------------------------------------
  // Écriture en base (transaction, purge préalable des fixtures)
  // -------------------------------------------------------------------------

  const sirens = new Map<string, typeof schema.entreprise.$inferInsert>();
  for (const e of etabs) {
    if (!sirens.has(e.siren)) {
      sirens.set(e.siren, {
        siren: e.siren,
        denomination: e.denomination,
        categorie: e.effectifEstime >= 250 ? "ETI" : "PME",
        dateCreation: e.dateCreation,
        etat: e.etatAdministratif === "F" ? "C" : "A",
      });
    }
  }
  entreprises.push(...sirens.values());

  db.transaction((tx) => {
    tx.delete(schema.lead).run();
    tx.delete(schema.scoreStrate).run();
    tx.delete(schema.scoreSismo).run();
    tx.delete(schema.signal).where(like(schema.signal.source, "fixture:%")).run();
    tx.delete(schema.offreBrute).where(like(schema.offreBrute.source, "fixture:%")).run();
    tx.delete(schema.resolutionQueue).where(like(schema.resolutionQueue.source, "fixture:%")).run();
    tx.delete(schema.ingestionRun).where(like(schema.ingestionRun.source, "fixture:%")).run();
    tx.delete(schema.etablissement).where(like(schema.etablissement.siren, "900%")).run();
    tx.delete(schema.entreprise).where(like(schema.entreprise.siren, "900%")).run();

    for (const e of entreprises) tx.insert(schema.entreprise).values(e).run();
    for (const e of etabs) {
      const { secteurId: _ignore, ...row } = e;
      tx.insert(schema.etablissement).values(row).run();
    }
    for (const s of signaux) tx.insert(schema.signal).values(s).run();
    for (const o of offres) tx.insert(schema.offreBrute).values(o).run();
    for (const r of resolutions) tx.insert(schema.resolutionQueue).values(r).run();

    // Journal d'ingestion : un run fictif par source pour la page /ingestion
    const parSource = new Map<string, number>();
    for (const s of signaux) parSource.set(s.source, (parSource.get(s.source) ?? 0) + 1);
    let runId = 0;
    for (const [source, count] of parSource) {
      runId++;
      tx.insert(schema.ingestionRun)
        .values({
          id: `fx-run-${runId}`,
          source,
          startedAt: iso(0, 2),
          finishedAt: iso(0, 1),
          recordsIn: count + randInt(rng, 5, 40),
          recordsOut: count,
          errors: [],
        })
        .run();
    }
  });

  return {
    entreprises: entreprises.length,
    etablissements: etabs.length,
    signaux: signaux.length,
    offres: offres.length,
    resolutions: resolutions.length,
  };
}
