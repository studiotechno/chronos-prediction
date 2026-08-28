/**
 * Fixtures réalistes — bassin de Vichy (Allier).
 * ~400 établissements, ~1200 signaux, générés déterministiquement (RNG seedé).
 * Les dates sont RELATIVES au moment du seed (J-2, J-15…) pour que la décroissance
 * temporelle produise le même classement crédible dans six mois.
 * Toutes les lignes sont étiquetées fixture : source = 'fixture:<source>' et SIREN en 900xxxxxx.
 */
import { like } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { chunk } from "../db/chunk";
import { mulberry32, pick, pickWeighted, randInt, chance, type Rng } from "./rng";
import { trancheByCode, trancheRank, TRANCHES_EFFECTIF } from "../reference/tranches";
import { romesDeCpv } from "../reference/metiers";

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

/* Compétences par domaine ROME (première lettre du code) : de quoi remplir une
   annonce de démo sans inventer un référentiel métier complet. */
const COMPETENCES_PAR_DOMAINE: Record<string, string[]> = {
  A: ["Conduite d'engin agricole", "Entretien des espaces verts", "Taille et élagage", "Traitement phytosanitaire"],
  F: ["Lecture de plan et de schéma", "Règles de sécurité sur chantier", "Coffrage et ferraillage", "Pose de bordures et de réseaux", "Conduite d'engin de chantier"],
  G: ["Accueil et conseil de la clientèle", "Service en salle", "Encaissement", "Règles d'hygiène HACCP"],
  H: ["Contrôle qualité en production", "Conduite de ligne automatisée", "Maintenance de premier niveau", "Lecture de gamme de fabrication", "Respect des cadences"],
  I: ["Diagnostic de panne", "Maintenance préventive", "Habilitation électrique", "Lecture de schéma technique"],
  J: ["Soins d'hygiène et de confort", "Accompagnement des personnes", "Transmission des observations"],
  K: ["Accompagnement des publics", "Animation d'atelier", "Rédaction de comptes rendus"],
  M: ["Saisie et suivi administratif", "Relation client", "Maîtrise des outils bureautiques", "Gestion des priorités"],
  N: ["Conduite de chariot élévateur (CACES)", "Préparation de commandes", "Gestion des stocks", "Chargement et déchargement", "Utilisation d'un scanner de codes-barres"],
};

const SAVOIR_ETRE = [
  "Faire preuve d'autonomie",
  "Travailler en équipe",
  "Faire preuve de rigueur et de précision",
  "Organiser son travail selon les priorités",
];

type Commune = { nom: string; cp: string; insee: string; lat: number; lon: number; poids: number };

const COMMUNES: Commune[] = [
  { nom: "Vichy", cp: "03200", insee: "03310", lat: 46.1264, lon: 3.4258, poids: 8 },
  { nom: "Cusset", cp: "03300", insee: "03095", lat: 46.134, lon: 3.456, poids: 6 },
  { nom: "Bellerive-sur-Allier", cp: "03700", insee: "03023", lat: 46.116, lon: 3.404, poids: 5 },
  { nom: "Abrest", cp: "03200", insee: "03001", lat: 46.095, lon: 3.443, poids: 2 },
  { nom: "Saint-Yorre", cp: "03270", insee: "03264", lat: 46.066, lon: 3.464, poids: 3 },
  { nom: "Hauterive", cp: "03270", insee: "03126", lat: 46.089, lon: 3.448, poids: 1 },
  { nom: "Saint-Germain-des-Fossés", cp: "03260", insee: "03236", lat: 46.206, lon: 3.435, poids: 3 },
  { nom: "Creuzier-le-Vieux", cp: "03300", insee: "03094", lat: 46.155, lon: 3.44, poids: 2 },
  { nom: "Charmeil", cp: "03110", insee: "03060", lat: 46.17, lon: 3.4, poids: 2 },
  { nom: "Gannat", cp: "03800", insee: "03118", lat: 46.1, lon: 3.199, poids: 4 },
  { nom: "Saint-Pourçain-sur-Sioule", cp: "03500", insee: "03254", lat: 46.309, lon: 3.289, poids: 4 },
  { nom: "Varennes-sur-Allier", cp: "03150", insee: "03298", lat: 46.312, lon: 3.402, poids: 4 },
  { nom: "Lapalisse", cp: "03120", insee: "03138", lat: 46.248, lon: 3.638, poids: 2 },
  { nom: "Le Mayet-de-Montagne", cp: "03250", insee: "03165", lat: 46.072, lon: 3.664, poids: 1 },
  { nom: "Bessay-sur-Allier", cp: "03340", insee: "03025", lat: 46.442, lon: 3.363, poids: 2 },
  { nom: "Moulins", cp: "03000", insee: "03190", lat: 46.566, lon: 3.333, poids: 3 },
  { nom: "Yzeure", cp: "03400", insee: "03321", lat: 46.565, lon: 3.355, poids: 2 },
  { nom: "Avermes", cp: "03000", insee: "03013", lat: 46.594, lon: 3.307, poids: 1 },
  { nom: "Dompierre-sur-Besbre", cp: "03290", insee: "03102", lat: 46.522, lon: 3.681, poids: 2 },
  { nom: "Commentry", cp: "03600", insee: "03082", lat: 46.291, lon: 2.744, poids: 1 },
  { nom: "Montluçon", cp: "03100", insee: "03185", lat: 46.341, lon: 2.603, poids: 1 },
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
  /** Conventions collectives déclarées en DSN (IDCC) : l'activité réelle, plus fine que la NAF. */
  idcc: string[];
  /** Chiffre d'affaires moyen par salarié (€), pour des finances de démo plausibles. */
  caParSalarie: number;
};

const GEO = [
  "BOURBONNAIS", "ALLIER", "SIOULE", "BESBRE", "THERMAL", "TRONÇAIS", "LIMAGNE",
  "BOCAGE", "COMBRAILLE", "AUVERGNE", "SOURCES", "MONTAGNE", "BILLY", "CHANTELLE", "FORTERRE",
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
    idcc: ["1597", "2609"],
    caParSalarie: 130000,
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
    idcc: ["16"],
    caParSalarie: 150000,
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
    idcc: ["16"],
    caParSalarie: 160000,
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
    idcc: ["3248"],
    caParSalarie: 220000,
  },
  {
    id: "agro",
    poids: 7,
    nafs: ["10.13A", "10.39A", "10.71C", "56.21Z"],
    activites: ["SALAISONS", "CONSERVES", "FOURNIL", "TRAITEUR", "AGROALIMENTAIRE"],
    offres: [
      { intitule: "Ouvrier agroalimentaire (H/F)", rome: "H2102" },
      { intitule: "Conducteur de ligne (H/F)", rome: "H2102" },
      { intitule: "Conducteur de ligne d'embouteillage (H/F)", rome: "H2102" },
    ],
    tranches: [["03", 15], ["11", 30], ["12", 30], ["21", 15], ["22", 10]],
    idcc: ["1396"],
    caParSalarie: 240000,
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
    idcc: ["3043"],
    caParSalarie: 45000,
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
    idcc: ["1486"],
    caParSalarie: 120000,
  },
];

/** Conventions par code NAF quand la NAF dit mieux que le secteur (grande distribution, garage). */
const IDCC_PAR_NAF: Record<string, string[]> = {
  "47.11F": ["2216"],
  "45.20A": ["1090"],
  "46.90Z": ["573"],
  "69.20Z": ["787"],
  "56.21Z": ["1979"],
};

const AGENCES_INTERIM = ["Adecco", "Manpower", "Randstad", "Proman", "Crit", "Synergie", "Actual", "Temporis"];

const ACHETEURS_PUBLICS = [
  "Vichy Communauté",
  "Ville de Vichy",
  "Conseil départemental de l'Allier",
  "Ville de Cusset",
  "Moulins Communauté",
  "Allier Habitat",
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
  codeInsee: string;
  caractereEmployeur: string;
  idcc: string[];
  enseignes: string[] | null;
  nomCommercial: string | null;
};

export async function seedFixtures(db: PostgresJsDatabase<typeof schema>): Promise<SeedStats> {
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
      codeInsee: args.commune.insee,
      caractereEmployeur: t.midpoint > 0 ? "O" : "N",
      idcc: IDCC_PAR_NAF[args.naf] ?? SECTEURS.find((sec) => sec.id === args.secteurId)?.idcc ?? [],
      // Une entreprise sur six est connue sous une enseigne différente de sa raison sociale.
      enseignes: chance(rng, 0.16) ? [`${args.denomination.split(" ")[0]} ${pick(rng, ["PRO", "SERVICES", "03", "AUVERGNE"])}`] : null,
      nomCommercial: null,
    };
    etabs.push(etab);
    return etab;
  }

  const etabParSiret = () => new Map(etabs.map((e) => [e.siret, e]));

  /**
   * Chaque signal porte le LIEU DU BESOIN et les métiers induits : par défaut
   * l'établissement lui-même (lieu de travail = siège), sauf quand la fixture
   * dit autre chose — un chantier ailleurs, un entrepôt en construction.
   */
  function ajouteSignal(args: {
    siret: string | null;
    siren: string | null;
    type: string;
    source: string;
    occurredAt: string;
    confidence: number;
    payload: Record<string, unknown>;
    /** Commune du besoin (chantier, lieu de travail) ; à défaut celle de l'établissement. */
    lieu?: Commune | null;
    romes?: string[] | null;
  }): typeof schema.signal.$inferInsert {
    sigCounter++;
    let lieu: schema.SignalLieu | null = null;
    if (args.lieu) {
      lieu = { lat: jitter(args.lieu.lat), lon: jitter(args.lieu.lon), libelle: args.lieu.nom };
    } else if (args.siret) {
      const e = etabParSiret().get(args.siret);
      if (e) lieu = { lat: e.lat, lon: e.lon, libelle: e.commune };
    }
    const rome = typeof args.payload.rome === "string" ? (args.payload.rome as string) : null;
    const romes = args.romes ?? (rome ? [rome] : null);
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
      lieu,
      romes,
    };
    signaux.push(s);
    return s;
  }

  /* Contenu d'annonce pour le bassin de démo. France Travail publie une
     description, un salaire et des compétences ; sans eux, la chronologie de
     démo se déplie sur du vide. Reconstitué à partir du métier ROME, avec un
     RNG dérivé du compteur d'offres : le flux aléatoire principal — donc le
     classement du bassin — n'est pas décalé d'un cran. */
  function contenuOffre(args: {
    id: number;
    intitule: string;
    rome: string;
    typeContrat: string;
    dureeJours: number | null;
    entrepriseNom: string;
    commune: Commune;
  }): Record<string, unknown> {
    const r = mulberry32(SEED + args.id);
    const domaine = args.rome.charAt(0).toUpperCase();
    const pool = COMPETENCES_PAR_DOMAINE[domaine] ?? COMPETENCES_PAR_DOMAINE.M;
    const competences = pool.slice(0, randInt(r, 3, Math.min(5, pool.length)));
    const metier = args.intitule.replace(/\s*\(H\/F\)\s*$/, "");
    const bas = 1900 + randInt(r, 0, 10) * 50;
    const haut = bas + randInt(r, 1, 6) * 50;
    const annees = randInt(r, 0, 5);
    const contratFr =
      args.typeContrat === "MIS"
        ? `Intérim${args.dureeJours ? ` - ${args.dureeJours} Jour(s)` : ""}`
        : args.typeContrat === "CDD"
          ? `CDD${args.dureeJours ? ` - ${Math.round(args.dureeJours / 30)} Mois` : ""}`
          : "CDI";
    const description = [
      `${args.entrepriseNom} recherche un(e) ${metier} pour son site de ${args.commune.nom}.`,
      "",
      "Vos missions :",
      ...competences.map((c) => `- ${c}`),
      "",
      `Poste à pourvoir en ${contratFr}, 35H par semaine. Rémunération selon profil et expérience.`,
      annees === 0
        ? "Débutant accepté : une formation interne est assurée à la prise de poste."
        : `Une expérience d'au moins ${annees} an(s) sur un poste similaire est attendue.`,
    ].join("\n");

    return {
      description,
      appellationLibelle: metier,
      romeLibelle: metier,
      typeContratLibelle: contratFr,
      salaireLibelle: `Mensuel de ${bas}.0 Euros à ${haut}.0 Euros sur 12 mois`,
      salaireComplements: chance(r, 0.4) ? ["Primes", "Titres restaurant / Prime de panier"] : null,
      dureeTravailLibelle: "35H/semaine",
      horaires: ["35H/semaine", chance(r, 0.3) ? "Travail posté (2x8, 3x8)" : "Travail en journée"],
      experienceLibelle: annees === 0 ? "Débutant accepté" : `${annees} An(s)`,
      qualificationLibelle: chance(r, 0.5) ? "Employé qualifié" : "Ouvrier spécialisé",
      competences,
      savoirEtre: SAVOIR_ETRE.slice(0, randInt(r, 2, 4)),
      permis: "FNAI".includes(domaine) ? ["B - Véhicule léger (exigé)"] : null,
    };
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
    nombrePostes?: number;
    manqueCandidats?: boolean;
    /** Nombre d'actualisations vues chez la source ; la dernière est datée au plus tôt hier. */
    nbActualisations?: number;
    trancheEffectifEtab?: string | null;
  }) {
    offreCounter++;
    const nbActu = args.nbActualisations ?? 0;
    const idOffre = `fx-offre-${String(offreCounter).padStart(5, "0")}`;
    offres.push({
      id: idOffre,
      siret: args.siret,
      entrepriseNom: args.entrepriseNom,
      intitule: args.intitule,
      typeContrat: args.typeContrat,
      dureeContratJours: args.dureeJours ?? null,
      rome: args.rome,
      codePostal: args.commune.cp,
      commune: args.commune.nom,
      codeInsee: args.commune.insee,
      lat: jitter(args.commune.lat),
      lon: jitter(args.commune.lon),
      parAgenceInterim: args.parAgence ? 1 : 0,
      datePublication: iso(args.publieeIlYaJours),
      dateActualisation: nbActu > 0 ? iso(Math.max(1, Math.floor(args.publieeIlYaJours / (nbActu + 1)))) : null,
      nbActualisations: nbActu,
      nombrePostes: args.nombrePostes ?? 1,
      manqueCandidats: args.manqueCandidats ? 1 : 0,
      trancheEffectifEtab: args.trancheEffectifEtab ?? null,
      firstSeenAt: iso(args.publieeIlYaJours),
      lastSeenAt: args.closeIlYaJours != null ? iso(args.closeIlYaJours) : nowIso,
      closedAt: args.closeIlYaJours != null ? iso(args.closeIlYaJours) : null,
      source: "fixture:francetravail",
      payload: contenuOffre({
        id: offreCounter,
        intitule: args.intitule,
        rome: args.rome,
        typeContrat: args.typeContrat,
        dureeJours: args.dureeJours ?? null,
        entrepriseNom: args.entrepriseNom,
        commune: args.commune,
      }),
    });
    return idOffre;
  }

  const confFt = () => 0.8 + rng() * 0.19;

  // -------------------------------------------------------------------------
  // Personas — le test de bon sens du classement
  // -------------------------------------------------------------------------

  // P1 — PME du BTP qui republie ses offres et vient de gagner un marché → tête de classement
  const p1Commune = communeByNom.get("Cusset")!;
  const p1 = ajouteEtab({
    siren: "900100001",
    nic: "00011",
    denomination: "BÂTIR BOURBONNAIS",
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
  // Le chantier est à Saint-Pourçain, à 25 km du siège de Cusset : c'est là qu'est le besoin.
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "MARCHE_ATTRIBUE",
    source: "fixture:boamp",
    occurredAt: iso(24),
    confidence: 1,
    payload: {
      objet: "Aménagement de l'entrée Nord — voirie et réseaux",
      montant: 480000,
      acheteur: "21030254000018",
      acheteurNom: "Commune de Saint-Pourçain-sur-Sioule",
      cpv: "45233140-2",
    },
    lieu: communeByNom.get("Saint-Pourçain-sur-Sioule")!,
    romes: ["F1702", "F1302", "F1704"],
  });
  ajouteSignal({
    siret: p1.siret,
    siren: p1.siren,
    type: "OFFRE_MANQUE_CANDIDATS",
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
    manqueCandidats: true,
    trancheEffectifEtab: "21",
  });

  // P2 — logistique en croissance d'effectif → tête de classement
  const p2Commune = communeByNom.get("Varennes-sur-Allier")!;
  const p2 = ajouteEtab({
    siren: "900100002",
    nic: "00011",
    denomination: "VAL D'ALLIER LOGISTIQUE",
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
  ajouteSignal({
    siret: p2.siret,
    siren: p2.siren,
    type: "OFFRE_MULTIPOSTES",
    source: "fixture:francetravail",
    occurredAt: iso(4),
    confidence: 0.94,
    payload: { intitule: "Préparateur de commandes (H/F)", rome: "N1103", nombrePostes: 6 },
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
  const p3Commune = communeByNom.get("Gannat")!;
  const p3 = ajouteEtab({
    siren: "900100003",
    nic: "00011",
    denomination: "MÉTALLERIE DU BOCAGE",
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
    payload: { procedure: "redressement judiciaire", tribunal: "Tribunal de commerce de Cusset" },
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
  const p4Commune = communeByNom.get("Vichy")!;
  const p4 = ajouteEtab({
    siren: "900100004",
    nic: "00011",
    denomination: "BOURBON CONSEIL STRATÉGIE",
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

  // P5 — plasturgie qui signe un accord d'heures sup et voit son CA grimper → capacité tendue
  const p5Commune = communeByNom.get("Saint-Yorre")!;
  const p5 = ajouteEtab({
    siren: "900100005",
    nic: "00011",
    denomination: "PLASTIQUES DES SOURCES",
    naf: "22.22Z",
    tranche: "22",
    commune: p5Commune,
    dateCreation: "2004-10-05",
    secteurId: "industrie",
  });
  ajouteSignal({
    siret: p5.siret,
    siren: p5.siren,
    type: "ACCORD_SURCHARGE",
    source: "fixture:acco",
    occurredAt: iso(33),
    confidence: 1,
    payload: {
      themes: ["052", "059"],
      themesFr: "heures supplémentaires, modulation",
      titre: "Accord relatif au contingent d'heures supplémentaires et à l'annualisation du temps de travail",
    },
  });
  ajouteSignal({
    siret: p5.siret,
    siren: p5.siren,
    type: "CA_CROISSANCE",
    source: "fixture:sirene",
    occurredAt: iso(58),
    confidence: 1,
    payload: { annee: 2024, ca: 21400000, caPrecedent: 17300000, deltaPct: 23.7 },
  });
  ajouteSignal({
    siret: p5.siret,
    siren: p5.siren,
    type: "OFFRE_REACTUALISEE",
    source: "fixture:francetravail",
    occurredAt: iso(3),
    confidence: 0.93,
    payload: {
      intitule: "Opérateur de production (H/F)",
      rome: "H3302",
      nbActualisations: 3,
      premierePublication: iso(38),
    },
  });
  ajouteOffre({
    siret: p5.siret,
    entrepriseNom: p5.denomination,
    intitule: "Opérateur de production (H/F)",
    rome: "H3302",
    typeContrat: "CDD",
    dureeJours: 90,
    commune: p5Commune,
    publieeIlYaJours: 38,
    nbActualisations: 3,
    nombrePostes: 2,
    trancheEffectifEtab: "22",
  });

  // P6 — logisticien qui construit un entrepôt à Bessay : chantier d'abord, exploitation ensuite
  const p6Commune = communeByNom.get("Moulins")!;
  const p6 = ajouteEtab({
    siren: "900100006",
    nic: "00011",
    denomination: "BOURBONNAIS LOGISTIQUE",
    naf: "52.10B",
    tranche: "21",
    commune: p6Commune,
    dateCreation: "2011-02-28",
    secteurId: "logistique",
  });
  ajouteSignal({
    siret: p6.siret,
    siren: p6.siren,
    type: "PERMIS_LOCAUX",
    source: "fixture:sitadel",
    occurredAt: iso(60),
    confidence: 1,
    payload: { surface: 8200, destination: "Entrepôt", nature: "Construction nouvelle", commune: "Bessay-sur-Allier" },
    lieu: communeByNom.get("Bessay-sur-Allier")!,
    romes: ["F1703", "F1704", "N1103", "N1101"],
  });
  ajouteSignal({
    siret: p6.siret,
    siren: p6.siren,
    type: "OFFRE_DIRECTE",
    source: "fixture:francetravail",
    occurredAt: iso(9),
    confidence: 0.91,
    payload: { intitule: "Cariste CACES 1-3-5 (H/F)", rome: "N1101", typeContrat: "CDI" },
  });

  // Appels d'offres ouverts sur le bassin : signaux de Tempo, aucun SIRET
  ajouteSignal({
    siret: null,
    siren: null,
    type: "AO_OUVERT",
    source: "fixture:boamp",
    occurredAt: iso(11),
    confidence: 1,
    payload: {
      acheteurNom: "Vichy Communauté",
      objet: "Travaux de réfection de voirie sur les communes de l'agglomération — programme 2027",
      typeMarche: "TRAVAUX",
      descripteurs: ["Voirie et réseaux divers"],
      dateLimiteReponse: iso(-30),
    },
    lieu: communeByNom.get("Vichy")!,
    romes: ["F1702", "F1302", "F1704"],
  });
  ajouteSignal({
    siret: null,
    siren: null,
    type: "AO_OUVERT",
    source: "fixture:boamp",
    occurredAt: iso(5),
    confidence: 1,
    payload: {
      acheteurNom: "Conseil départemental de l'Allier",
      objet: "Nettoyage des locaux des collèges du département",
      typeMarche: "SERVICES",
      descripteurs: ["Nettoyage de locaux"],
      dateLimiteReponse: iso(-35),
    },
    lieu: communeByNom.get("Moulins")!,
    romes: ["K2204"],
  });

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
          tribunal: pick(rng, [
            "Tribunal de commerce de Cusset",
            "Tribunal de commerce de Moulins",
            "Tribunal de commerce de Montluçon",
          ]),
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
            ["OFFRE_DIRECTE", 40],
            ["CDD_COURT_REPETE", 10],
            ["OFFRE_REPUBLIEE", 7],
            ["OFFRE_REACTUALISEE", 6],
            ["OFFRE_MANQUE_CANDIDATS", 5],
            ["OFFRE_MULTIPOSTES", 4],
            ["OFFRE_VELOCITE", 4],
            ["MARCHE_ATTRIBUE", 6],
            ["EFFECTIF_UP", 6],
            ["CA_CROISSANCE", 5],
            ["BODACC_CAPITAL", 5],
            ["ACCORD_SURCHARGE", 2],
          ] as const)
        : pickWeighted(rng, [
            ["OFFRE_DIRECTE", 70],
            ["EFFECTIF_UP", 12],
            ["CA_CROISSANCE", 8],
            ["BODACC_CAPITAL", 10],
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
      } else if (type === "OFFRE_MANQUE_CANDIDATS" || type === "OFFRE_MULTIPOSTES" || type === "OFFRE_REACTUALISEE") {
        const offre = pick(rng, secteur.offres);
        const j = ageRecent(30);
        const nombrePostes = type === "OFFRE_MULTIPOSTES" ? randInt(rng, 2, 8) : 1;
        const nbActualisations = type === "OFFRE_REACTUALISEE" ? randInt(rng, 2, 5) : 0;
        const payload: Record<string, unknown> =
          type === "OFFRE_MULTIPOSTES"
            ? { intitule: offre.intitule, rome: offre.rome, nombrePostes }
            : type === "OFFRE_REACTUALISEE"
              ? { intitule: offre.intitule, rome: offre.rome, nbActualisations, premierePublication: iso(j + nbActualisations * 12) }
              : { intitule: offre.intitule, rome: offre.rome, typeContrat: "CDI" };
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:francetravail",
          occurredAt: iso(j, randInt(rng, 0, 12)),
          confidence: confFt(),
          payload,
        });
        ajouteOffre({
          siret: etab.siret,
          entrepriseNom: nom,
          intitule: offre.intitule,
          rome: offre.rome,
          typeContrat: "CDI",
          commune,
          publieeIlYaJours: type === "OFFRE_REACTUALISEE" ? j + nbActualisations * 12 : j,
          nombrePostes,
          manqueCandidats: type === "OFFRE_MANQUE_CANDIDATS",
          nbActualisations,
          trancheEffectifEtab: etab.trancheEffectif,
        });
      } else if (type === "CA_CROISSANCE") {
        const caPrecedent = Math.round((etab.effectifEstime || 5) * secteur.caParSalarie * (0.8 + rng() * 0.4));
        const delta = 0.15 + rng() * 0.3;
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:sirene",
          occurredAt: iso(randInt(rng, 30, 120)),
          confidence: 1,
          payload: {
            annee: 2024,
            ca: Math.round(caPrecedent * (1 + delta)),
            caPrecedent,
            deltaPct: Math.round(delta * 1000) / 10,
          },
        });
      } else if (type === "ACCORD_SURCHARGE") {
        const themes = pick(rng, [
          { codes: ["052"], fr: "heures supplémentaires" },
          { codes: ["059"], fr: "modulation du temps de travail" },
          { codes: ["055"], fr: "travail de nuit" },
          { codes: ["052", "059"], fr: "heures supplémentaires, modulation" },
        ]);
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:acco",
          occurredAt: iso(randInt(rng, 15, 110)),
          confidence: 1,
          payload: { themes: themes.codes, themesFr: themes.fr, titre: `Accord d'entreprise relatif à : ${themes.fr}` },
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
        // Un chantier sur trois est ailleurs que le siège : le besoin est sur le chantier.
        const chantier = chance(rng, 0.33) ? pickWeighted(rng, COMMUNES.map((c) => [c, c.poids] as const)) : null;
        ajouteSignal({
          siret: etab.siret,
          siren,
          type,
          source: "fixture:decp",
          occurredAt: iso(randInt(rng, 5, 85)),
          confidence: 1,
          payload: { objet: marche.objet, montant, acheteurNom: pick(rng, ACHETEURS_PUBLICS), cpv: marche.cpv },
          lieu: chantier,
          romes: romesDeCpv(marche.cpv),
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
      `${cible.denomination.split(" ")[0]} ${pick(rng, ["SERVICES", "GROUPE", "03"])}`,
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

    const autres = [bulkActifs[(q * 53 + 101) % bulkActifs.length], bulkActifs[(q * 71 + 211) % bulkActifs.length]].filter(
      (a, i, arr) => a.siret !== cible.siret && arr.findIndex((x) => x.siret === a.siret) === i,
    );
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
  // Rattachement signal → offre
  // -------------------------------------------------------------------------
  // Ici, signal et offre sont écrits côte à côte ; le vrai pipeline, lui, dérive
  // le signal DEPUIS l'offre et en garde l'identifiant. On rétablit ce lien après
  // coup — même SIRET (ou même agence), même intitulé, publication la plus proche
  // de la date du signal — sinon la chronologie de démo n'aurait rien à déplier.
  // Fait après génération pour ne pas décaler d'un cran le flux aléatoire.
  const TYPES_LIABLES = new Set([
    "OFFRE_DIRECTE",
    "OFFRE_MANQUE_CANDIDATS",
    "OFFRE_MULTIPOSTES",
    "OFFRE_REACTUALISEE",
    "OFFRE_REPUBLIEE",
    "MISSION_CONCURRENT",
  ]);
  for (const sig of signaux) {
    if (!TYPES_LIABLES.has(sig.type)) continue;
    const p = (sig.payload ?? {}) as Record<string, unknown>;
    const intitule = typeof p.intitule === "string" ? p.intitule : null;
    if (!intitule) continue;
    const candidates = offres.filter(
      (o) =>
        o.intitule === intitule &&
        (sig.siret ? o.siret === sig.siret : o.entrepriseNom === p.agenceInterim),
    );
    if (candidates.length === 0) continue;
    const cible = new Date(sig.occurredAt).getTime();
    const ecart = (o: (typeof candidates)[number]) =>
      Math.abs(new Date(o.datePublication).getTime() - cible);
    const meilleure = candidates.reduce((a, b) => (ecart(a) <= ecart(b) ? a : b));
    sig.payload = { ...p, offreId: meilleure.id };
  }

  // -------------------------------------------------------------------------
  // Écriture en base (transaction, purge préalable des fixtures)
  // -------------------------------------------------------------------------

  const sirens = new Map<string, typeof schema.entreprise.$inferInsert>();
  for (const e of etabs) {
    if (!sirens.has(e.siren)) {
      // Finances plausibles (RNE) : CA proportionnel à l'effectif, résultat entre −3 % et +8 %.
      const secteur = SECTEURS.find((sec) => sec.id === e.secteurId)!;
      const ca = Math.round((e.effectifEstime || 3) * secteur.caParSalarie * (0.75 + rng() * 0.5));
      const caPrecedent = Math.round(ca / (0.92 + rng() * 0.2));
      const marge = -0.03 + rng() * 0.11;
      sirens.set(e.siren, {
        siren: e.siren,
        denomination: e.denomination,
        categorie: e.effectifEstime >= 250 ? "ETI" : "PME",
        dateCreation: e.dateCreation,
        etat: e.etatAdministratif === "F" ? "C" : "A",
        caractereEmployeur: e.caractereEmployeur,
        nbEtabsOuverts: etabs.filter((x) => x.siren === e.siren && x.etatAdministratif === "A").length,
        caAnnee: 2024,
        ca,
        caPrecedent,
        resultatNet: Math.round(ca * marge),
        resultatNetPrecedent: Math.round(caPrecedent * (marge - 0.01)),
        idcc: e.idcc,
        complements: { convention_collective_renseignee: e.idcc.length > 0 },
      });
    }
  }
  entreprises.push(...sirens.values());

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const etabRows = etabs.map(({ secteurId, ...row }) => ({ ...row, trancheEffectifSource: "sirene" }));

  // Journal d'ingestion : un run fictif par source pour la page /ingestion
  const parSource = new Map<string, number>();
  for (const s of signaux) parSource.set(s.source, (parSource.get(s.source) ?? 0) + 1);
  const runs = [...parSource].map(([source, count], i) => ({
    id: `fx-run-${i + 1}`,
    source,
    startedAt: iso(0, 2),
    finishedAt: iso(0, 1),
    recordsIn: count + randInt(rng, 5, 40),
    recordsOut: count,
    errors: [],
  }));

  // Une transaction unique, en insertions par lots : sur une base distante,
  // une requête par ligne mettrait le seed à genoux.
  await db.transaction(async (tx) => {
    await tx.delete(schema.lead);
    await tx.delete(schema.scoreStrate);
    await tx.delete(schema.scoreSismo);
    await tx.delete(schema.scoreTempo);
    await tx.delete(schema.scoreSnapshot).where(like(schema.scoreSnapshot.siret, "900%"));
    await tx.delete(schema.crmOutcome).where(like(schema.crmOutcome.siret, "900%"));
    await tx.delete(schema.signal).where(like(schema.signal.source, "fixture:%"));
    await tx.delete(schema.offreBrute).where(like(schema.offreBrute.source, "fixture:%"));
    await tx.delete(schema.resolutionQueue).where(like(schema.resolutionQueue.source, "fixture:%"));
    await tx.delete(schema.ingestionRun).where(like(schema.ingestionRun.source, "fixture:%"));
    await tx.delete(schema.etablissement).where(like(schema.etablissement.siren, "900%"));
    await tx.delete(schema.entreprise).where(like(schema.entreprise.siren, "900%"));

    for (const paquet of chunk(entreprises)) await tx.insert(schema.entreprise).values(paquet);
    for (const paquet of chunk(etabRows)) await tx.insert(schema.etablissement).values(paquet);
    for (const paquet of chunk(signaux)) await tx.insert(schema.signal).values(paquet);
    for (const paquet of chunk(offres)) await tx.insert(schema.offreBrute).values(paquet);
    for (const paquet of chunk(resolutions)) await tx.insert(schema.resolutionQueue).values(paquet);
    for (const paquet of chunk(runs)) await tx.insert(schema.ingestionRun).values(paquet);
  });

  return {
    entreprises: entreprises.length,
    etablissements: etabs.length,
    signaux: signaux.length,
    offres: offres.length,
    resolutions: resolutions.length,
  };
}
