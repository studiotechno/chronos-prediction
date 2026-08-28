/**
 * France Travail — API Offres d'emploi v2.
 *
 * ENDPOINTS VÉRIFIÉS le 28/08/2026 par appels réels authentifiés (voir docs/sources.md) :
 *   POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire
 *        grant_type=client_credentials, scope="api_offresdemploiv2 o2dsoffre"
 *        → { access_token, expires_in } (≈ 1500 s)
 *   GET  https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search
 *        ?departement=&minCreationDate=&maxCreationDate=&range=a-b
 *        → 206 Partial Content + en-tête `Content-Range: offres a-b/total`
 *
 * Contraintes vérifiées sur l'API réelle :
 * - `range` est plafonné à 150 éléments (0-199 renvoie 400) ;
 * - `minCreationDate` seul renvoie 400 : les deux bornes sont obligatoires ;
 * - au-delà des résultats disponibles, l'API renvoie 204 sans corps ;
 * - quota de 10 appels/seconde pour cette application.
 *
 * Champs exploités depuis la V2 (tous vérifiés sur 150 offres réelles de l'Allier) :
 * - `nombrePostes` (entier, 150/150), `offresManqueCandidats` (booléen, 150/150) ;
 * - `dateActualisation` : une offre non pourvue est réactualisée par l'employeur —
 *   compter les actualisations mesure le temps sur le marché SANS attendre la clôture ;
 * - `trancheEffectifEtab` : la tranche d'effectif de l'établissement employeur, en
 *   LIBELLÉ (« 20 à 49 salariés », 147/150), pas en code — convertie ci-dessous ;
 * - `lieuTravail.commune` : code INSEE du lieu de travail (clé de blocage du rapprochement).
 *
 * Champs de CONTENU de l'annonce, ajoutés pour la fiche lead (taux de remplissage
 * mesuré sur 15 011 offres réelles de l'Allier, cache d'ingestion) :
 * - `description` (100 %), `salaire` {libelle 46 %, commentaire 23 %, listeComplements 14 %} ;
 * - `contexteTravail.horaires` (65 %), `dureeTravailLibelle` (65 %) ;
 * - `experienceLibelle` (100 %), `competences` (41 %), `formations` (17 %),
 *   `permis` (12 %), `langues` (4 %), `qualitesProfessionnelles` (20 %) ;
 * - `appellationlibelle` (100 %) : l'intitulé ROME normalisé, plus précis que `intitule` ;
 * - `origineOffre.urlOrigine` (100 %) : l'URL publique de l'annonce, servie par la source
 *   plutôt que reconstruite à la main.
 *
 * DONNÉES PERSONNELLES : la réponse contient un objet `contact` avec des noms,
 * téléphones et courriels de personnes physiques (120 offres sur 150 observées).
 * Le projet ne collecte QUE des personnes morales : ce champ n'est jamais lu,
 * jamais stocké, et `normalize()` construit un enregistrement en liste blanche.
 * Les textes libres (`description`, `entreprise.description`) échappent par nature
 * à cette liste blanche : 0,5 % d'entre eux portent un courriel ou un téléphone de
 * recruteur. Ils passent donc par `caviarder()` avant stockage.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const URL_JETON =
  "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire";
const URL_RECHERCHE = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";
const SCOPE = "api_offresdemploiv2 o2dsoffre";
const TAILLE_PAGE = 150; // maximum accepté par l'API
const limiter = new RateLimiter(10);

/** Schéma calé sur la réponse réelle. Tout champ absent de cette liste est ignoré. */
export const ftOffreSchema = z.object({
  id: z.string(),
  intitule: z.string(),
  dateCreation: z.string(),
  /** Dernière actualisation par l'employeur : une offre qui reste ouverte est réactualisée. */
  dateActualisation: z.string().nullish(),
  romeCode: z.string().nullish(),
  /** Libellé métier fourni par la source : évite de maintenir un dictionnaire ROME. */
  romeLibelle: z.string().nullish(),
  typeContrat: z.string().nullish(),
  /** Porte la durée du contrat : « CDD - 12 Mois », « Intérim - 14 Jour(s) », « CDI ». */
  typeContratLibelle: z.string().nullish(),
  natureContrat: z.string().nullish(),
  /** NAF de l'employeur : la détection d'agence d'intérim (78.*) s'appuie dessus. */
  codeNAF: z.string().nullish(),
  secteurActivite: z.string().nullish(),
  secteurActiviteLibelle: z.string().nullish(),
  nombrePostes: z.number().nullish(),
  offresManqueCandidats: z.boolean().nullish(),
  alternance: z.boolean().nullish(),
  experienceExige: z.string().nullish(),
  qualificationCode: z.string().nullish(),
  qualificationLibelle: z.string().nullish(),
  /** Tranche d'effectif de l'établissement employeur, en libellé (« 20 à 49 salariés »). */
  trancheEffectifEtab: z.string().nullish(),

  // --- Contenu de l'annonce (fiche lead) ---
  /** Corps de l'annonce. Texte libre : caviardé avant stockage. */
  description: z.string().nullish(),
  /** Intitulé ROME normalisé (« Cariste manutentionnaire / Cariste manutentionnaire »). */
  appellationlibelle: z.string().nullish(),
  experienceLibelle: z.string().nullish(),
  experienceCommentaire: z.string().nullish(),
  /** Temps de travail hebdomadaire (« 35H/semaine ») — PAS la durée du contrat. */
  dureeTravailLibelle: z.string().nullish(),
  dureeTravailLibelleConverti: z.string().nullish(),
  deplacementLibelle: z.string().nullish(),
  accessibleTH: z.boolean().nullish(),
  employeurHandiEngage: z.boolean().nullish(),
  salaire: z
    .object({
      libelle: z.string().nullish(), // « Mensuel de 1982.0 Euros à 2398.0 Euros sur 12 mois »
      commentaire: z.string().nullish(),
      listeComplements: z
        .array(z.object({ libelle: z.string().nullish() }))
        .nullish(),
    })
    .nullish(),
  contexteTravail: z
    .object({
      horaires: z.array(z.string()).nullish(),
      conditionsExercice: z.array(z.string()).nullish(),
    })
    .nullish(),
  competences: z.array(z.object({ libelle: z.string().nullish(), exigence: z.string().nullish() })).nullish(),
  formations: z
    .array(
      z.object({
        niveauLibelle: z.string().nullish(),
        domaineLibelle: z.string().nullish(),
        exigence: z.string().nullish(),
      }),
    )
    .nullish(),
  permis: z.array(z.object({ libelle: z.string().nullish(), exigence: z.string().nullish() })).nullish(),
  langues: z.array(z.object({ libelle: z.string().nullish(), exigence: z.string().nullish() })).nullish(),
  qualitesProfessionnelles: z.array(z.object({ libelle: z.string().nullish() })).nullish(),
  origineOffre: z
    .object({
      /** « 1 » : offre France Travail ; « 2 » : offre collectée chez un partenaire. */
      origine: z.string().nullish(),
      urlOrigine: z.string().nullish(),
      partenaires: z.array(z.object({ nom: z.string().nullish(), url: z.string().nullish() })).nullish(),
    })
    .nullish(),

  entreprise: z
    .object({
      nom: z.string().nullish(),
      // `siret` n'est jamais renseigné par cette API (0 offre sur 150 observées) :
      // le rapprochement d'entité est donc le chemin normal, pas l'exception.
      siret: z.string().nullish(),
      entrepriseAdaptee: z.boolean().nullish(),
      /** Présentation de l'employeur. Texte libre : caviardé avant stockage. */
      description: z.string().nullish(),
      url: z.string().nullish(),
    })
    .nullish(),
  lieuTravail: z
    .object({
      libelle: z.string().nullish(), // « 03 - Gannat »
      codePostal: z.string().nullish(),
      /** Code INSEE de la commune du lieu de travail. */
      commune: z.string().nullish(),
      latitude: z.number().nullish(),
      longitude: z.number().nullish(),
    })
    .nullish(),
});

const reponseSchema = z.object({
  resultats: z.array(z.unknown()).default([]),
});

export type FtOffreRaw = z.infer<typeof ftOffreSchema>;

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

let jetonCache: { valeur: string; expireA: number } | null = null;

async function obtenirJeton(): Promise<string> {
  if (jetonCache && Date.now() < jetonCache.expireA) return jetonCache.valeur;

  const clientId = process.env.FRANCETRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCETRAVAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "[francetravail] FRANCETRAVAIL_CLIENT_ID / FRANCETRAVAIL_CLIENT_SECRET absents. " +
        "Copiez .env.example vers .env et renseignez vos identifiants (voir README).",
    );
  }

  const res = await fetch(URL_JETON, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `[francetravail] échec de l'authentification (HTTP ${res.status}). ` +
        "Vérifiez vos identifiants et la souscription à « Offres d'emploi v2 » sur francetravail.io.",
    );
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  jetonCache = {
    valeur: body.access_token,
    // marge de 60 s pour ne pas expirer en plein milieu d'une pagination
    expireA: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
  };
  return jetonCache.valeur;
}

// ---------------------------------------------------------------------------
// Dérivations locales
// ---------------------------------------------------------------------------

/**
 * Caviardage des textes libres. Les corps d'annonce sont rédigés par des humains :
 * 0,5 % d'entre eux glissent un courriel ou un téléphone de recruteur au milieu du
 * texte, là où aucune liste blanche de champs ne peut les intercepter. On garde le
 * texte, on retire la coordonnée — le projet ne stocke pas de personne physique.
 */
export function caviarder(texte: string | null | undefined): string | null {
  if (!texte) return null;
  const propre = texte
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[courriel retiré]")
    .replace(/(?:\+33|0)\s?[1-9](?:[\s.\-]?\d{2}){4}/g, "[téléphone retiré]")
    .trim();
  return propre.length > 0 ? propre : null;
}

/** Liste de libellés non vides, dédoublonnée, ou null. Évite les tableaux vides en base. */
type ItemLibelle = { libelle?: string | null; exigence?: string | null };

function libelles(
  items: ItemLibelle[] | null | undefined,
  suffixe?: (it: ItemLibelle) => string,
): string[] | null {
  if (!items || items.length === 0) return null;
  const sortie = [
    ...new Set(
      items
        .map((it) => {
          const lb = it.libelle?.trim();
          if (!lb) return null;
          return suffixe ? `${lb}${suffixe(it)}` : lb;
        })
        .filter((x): x is string => !!x),
    ),
  ];
  return sortie.length > 0 ? sortie : null;
}

/** « E » (exigée) / « S » (souhaitée) — la source ne documente pas d'autre valeur. */
function marqueExigence(it: ItemLibelle): string {
  return it.exigence === "E" ? " (exigé)" : "";
}

/** « 03 - Gannat » → « Gannat ». */
export function communeDepuisLibelle(libelle: string | null | undefined): string | null {
  if (!libelle) return null;
  const m = libelle.match(/^\s*\d{2,3}\s*-\s*(.+)$/);
  return (m ? m[1] : libelle).trim() || null;
}

/**
 * Durée du contrat en jours, lue dans `typeContratLibelle`.
 * Piège vérifié sur l'API réelle : `dureeTravailLibelle` porte le temps de travail
 * hebdomadaire (« 35H/semaine »), pas la durée du contrat.
 */
export function dureeContratJours(typeContratLibelle: string | null | undefined): number | null {
  if (!typeContratLibelle) return null;
  const mois = typeContratLibelle.match(/(\d+)\s*Mois/i);
  if (mois) return Number(mois[1]) * 30;
  const jours = typeContratLibelle.match(/(\d+)\s*Jour/i);
  if (jours) return Number(jours[1]);
  return null;
}

/** Borne basse d'un libellé de tranche → code INSEE (variable trancheEffectifsEtablissement). */
const CODE_PAR_BORNE: [number, string][] = [
  [10000, "53"],
  [5000, "52"],
  [2000, "51"],
  [1000, "42"],
  [500, "41"],
  [250, "32"],
  [200, "31"],
  [100, "22"],
  [50, "21"],
  [20, "12"],
  [10, "11"],
  [6, "03"],
  [3, "02"],
  [1, "01"],
  [0, "00"],
];

/**
 * « 20 à 49 salariés » → « 12 », « 1 ou 2 salariés » → « 01 »,
 * « 0 salarié (n'ayant pas d'effectif au 31/12…) » → « 00 ».
 * France Travail publie la tranche en libellé ; le référentiel la stocke en code INSEE.
 * Un code déjà formé (« 12 ») est accepté tel quel.
 */
export function trancheCodeDepuisLibelle(libelle: string | null | undefined): string | null {
  if (!libelle) return null;
  const propre = libelle.trim();
  if (/^\d{2}$/.test(propre)) return propre;
  const m = propre.match(/^\s*(\d[\d\s]*)/);
  if (!m) return null;
  const borne = Number(m[1].replace(/\s/g, ""));
  if (!Number.isFinite(borne)) return null;
  for (const [min, code] of CODE_PAR_BORNE) if (borne >= min) return code;
  return null;
}

const MOTIFS_AGENCES = [
  "adecco", "manpower", "randstad", "proman", "crit intérim", "synergie",
  "actual", "temporis", "start people", "supplay", "interaction", "triangle",
  "aquila rh", "welljob", "job link", "samsic emploi", "domino rh",
];

/**
 * Offre postée par une agence d'intérim (donc à ne pas porter au crédit de
 * l'entreprise utilisatrice). Le NAF de l'annonceur est le critère fiable :
 * la division 78 est « Activités liées à l'emploi ». Le type de contrat MIS
 * vient en second, les enseignes en dernier recours.
 */
export function estAgenceInterim(
  codeNAF: string | null | undefined,
  typeContrat: string | null | undefined,
  nom: string | null | undefined,
): boolean {
  if (codeNAF && codeNAF.replace(/[^0-9]/g, "").startsWith("78")) return true;
  if (typeContrat === "MIS") return true;
  if (!nom) return false;
  const bas = nom.toLowerCase();
  return MOTIFS_AGENCES.some((m) => bas.includes(m));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

function iso(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

export const francetravailAdapter: SourceAdapter<FtOffreRaw> = {
  id: "francetravail",

  async *fetch(params: FetchParams): AsyncIterable<FtOffreRaw> {
    const departement = params.departement ?? "03";
    const jusqua = new Date();
    const depuis = new Date(jusqua.getTime() - (params.depuisJours ?? 14) * 86400000);
    const jeton = await obtenirJeton();

    let debut = 0;
    for (;;) {
      const fin = debut + TAILLE_PAGE - 1;
      const url =
        `${URL_RECHERCHE}?departement=${encodeURIComponent(departement)}` +
        `&minCreationDate=${encodeURIComponent(iso(depuis))}` +
        `&maxCreationDate=${encodeURIComponent(iso(jusqua))}` +
        `&range=${debut}-${fin}`;

      const brut = await fetchJsonCache("francetravail", url, limiter, {
        headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" },
      });
      // 204 : plus rien à paginer.
      if (brut == null) break;

      const page = reponseSchema.parse(brut);
      if (page.resultats.length === 0) break;

      for (const offre of page.resultats) {
        const parsed = ftOffreSchema.safeParse(offre);
        if (parsed.success) yield parsed.data;
        else throw new Error(`[francetravail] réponse inattendue : ${parsed.error.issues[0]?.message}`);
      }

      if (page.resultats.length < TAILLE_PAGE) break;
      debut += TAILLE_PAGE;
      if (debut > 3000) break; // plafond observé côté API
    }
  },

  normalize(raw: FtOffreRaw): NormalizedRecord[] {
    const nom = raw.entreprise?.nom ?? null;
    const parAgence = estAgenceInterim(raw.codeNAF, raw.typeContrat, nom);
    const lat = typeof raw.lieuTravail?.latitude === "number" && Number.isFinite(raw.lieuTravail.latitude) ? raw.lieuTravail.latitude : null;
    const lon = typeof raw.lieuTravail?.longitude === "number" && Number.isFinite(raw.lieuTravail.longitude) ? raw.lieuTravail.longitude : null;
    return [
      {
        kind: "offre",
        offre: {
          id: raw.id,
          siret: raw.entreprise?.siret ?? null,
          entrepriseNom: nom,
          intitule: raw.intitule,
          typeContrat: raw.typeContrat ?? null,
          dureeContratJours: dureeContratJours(raw.typeContratLibelle),
          rome: raw.romeCode ?? null,
          codePostal: raw.lieuTravail?.codePostal ?? null,
          commune: communeDepuisLibelle(raw.lieuTravail?.libelle),
          codeInsee: raw.lieuTravail?.commune ?? null,
          lat: lat != null && lon != null ? lat : null,
          lon: lat != null && lon != null ? lon : null,
          parAgenceInterim: parAgence ? 1 : 0,
          datePublication: raw.dateCreation,
          dateActualisation: raw.dateActualisation ?? null,
          nombrePostes: typeof raw.nombrePostes === "number" && raw.nombrePostes > 0 ? raw.nombrePostes : null,
          manqueCandidats: raw.offresManqueCandidats ? 1 : 0,
          trancheEffectifEtab: trancheCodeDepuisLibelle(raw.trancheEffectifEtab),
          source: "francetravail",
          // Liste blanche stricte : aucune donnée de contact (personne physique).
          // Les deux textes libres passent par caviarder().
          payload: {
            codeNAF: raw.codeNAF ?? null,
            romeLibelle: raw.romeLibelle ?? null,
            experienceExige: raw.experienceExige ?? null,
            qualificationCode: raw.qualificationCode ?? null,
            secteurActivite: raw.secteurActivite ?? null,
            natureContrat: raw.natureContrat ?? null,
            alternance: raw.alternance ?? null,
            trancheEffectifEtabLibelle: raw.trancheEffectifEtab ?? null,

            // --- Contenu de l'annonce, servi tel quel à la fiche lead ---
            description: caviarder(raw.description),
            appellationLibelle: raw.appellationlibelle ?? null,
            typeContratLibelle: raw.typeContratLibelle ?? null,
            secteurActiviteLibelle: raw.secteurActiviteLibelle ?? null,
            qualificationLibelle: raw.qualificationLibelle ?? null,
            experienceLibelle: raw.experienceLibelle ?? null,
            experienceCommentaire: raw.experienceCommentaire ?? null,
            salaireLibelle: raw.salaire?.libelle ?? null,
            salaireCommentaire: raw.salaire?.commentaire ?? null,
            salaireComplements: libelles(raw.salaire?.listeComplements),
            dureeTravailLibelle: raw.dureeTravailLibelle ?? null,
            dureeTravailConverti: raw.dureeTravailLibelleConverti ?? null,
            horaires: raw.contexteTravail?.horaires ?? null,
            conditionsExercice: raw.contexteTravail?.conditionsExercice ?? null,
            deplacementLibelle: raw.deplacementLibelle ?? null,
            competences: libelles(raw.competences, marqueExigence),
            formations: libelles(
              (raw.formations ?? []).map((f) => ({
                libelle: [f.niveauLibelle, f.domaineLibelle].filter(Boolean).join(" — ") || null,
                exigence: f.exigence,
              })),
              marqueExigence,
            ),
            permis: libelles(raw.permis, marqueExigence),
            langues: libelles(raw.langues, marqueExigence),
            savoirEtre: libelles(raw.qualitesProfessionnelles),
            accessibleTH: raw.accessibleTH ?? null,
            employeurHandiEngage: raw.employeurHandiEngage ?? null,
            entrepriseAdaptee: raw.entreprise?.entrepriseAdaptee ?? null,
            entrepriseDescription: caviarder(raw.entreprise?.description),
            entrepriseUrl: raw.entreprise?.url ?? null,
            urlOffre: raw.origineOffre?.urlOrigine ?? null,
            partenaire:
              raw.origineOffre?.origine === "2"
                ? (raw.origineOffre?.partenaires?.[0]?.nom ?? null)
                : null,
          },
        },
      },
    ];
  },

  fixture(): FtOffreRaw[] {
    const depuis = (j: number) => new Date(Date.now() - j * 86400000).toISOString();
    return [
      {
        id: "FIX-FT-1",
        intitule: "Cariste CACES 3 (H/F)",
        dateCreation: depuis(15),
        dateActualisation: depuis(3),
        romeCode: "N1101",
        romeLibelle: "Conduite d'engins de manutention",
        typeContrat: "CDI",
        typeContratLibelle: "CDI",
        natureContrat: "Contrat travail",
        codeNAF: "43.99C",
        secteurActivite: "43",
        nombrePostes: 3,
        offresManqueCandidats: true,
        alternance: false,
        experienceExige: "D",
        qualificationCode: "5",
        trancheEffectifEtab: "20 à 49 salariés",
        entreprise: { nom: "DEMO BATIMENT BOURBONNAIS", siret: null, entrepriseAdaptee: false },
        lieuTravail: { libelle: "03 - Vichy", codePostal: "03200", commune: "03310", latitude: 46.127, longitude: 3.426 },
      },
      {
        id: "FIX-FT-2",
        intitule: "Préparateur de commandes (H/F)",
        dateCreation: depuis(4),
        dateActualisation: depuis(4),
        romeCode: "N1103",
        romeLibelle: "Magasinage et préparation de commandes",
        typeContrat: "CDD",
        typeContratLibelle: "CDD - 2 Mois",
        natureContrat: "Contrat travail",
        codeNAF: "52.10B",
        secteurActivite: "52",
        nombrePostes: 1,
        offresManqueCandidats: false,
        alternance: false,
        experienceExige: "D",
        qualificationCode: "6",
        trancheEffectifEtab: "10 à 19 salariés",
        entreprise: { nom: "DEMO LOGISTIQUE ALLIER", siret: null, entrepriseAdaptee: false },
        lieuTravail: {
          libelle: "03 - Varennes-sur-Allier",
          codePostal: "03150",
          commune: "03298",
          latitude: 46.312,
          longitude: 3.402,
        },
      },
      {
        id: "FIX-FT-3",
        intitule: "Maçon (H/F)",
        dateCreation: depuis(2),
        dateActualisation: depuis(2),
        romeCode: "F1703",
        romeLibelle: "Maçonnerie",
        typeContrat: "MIS",
        typeContratLibelle: "Intérim - 1 Mois",
        natureContrat: "Contrat travail",
        codeNAF: "78.20Z",
        secteurActivite: "78",
        nombrePostes: 1,
        offresManqueCandidats: false,
        alternance: false,
        experienceExige: "E",
        qualificationCode: "5",
        trancheEffectifEtab: "6 à 9 salariés",
        entreprise: { nom: "ADECCO BTP VICHY", siret: null, entrepriseAdaptee: false },
        lieuTravail: { libelle: "03 - Cusset", codePostal: "03300", commune: "03095", latitude: 46.134, longitude: 3.456 },
      },
    ];
  },
};
