/**
 * France Travail — API Offres d'emploi v2.
 *
 * ENDPOINTS VÉRIFIÉS le 27/08/2026 par appels réels authentifiés (voir docs/sources.md) :
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
 * DONNÉES PERSONNELLES : la réponse contient un objet `contact` avec des noms,
 * téléphones et courriels de personnes physiques (120 offres sur 150 observées).
 * Le projet ne collecte QUE des personnes morales : ce champ n'est jamais lu,
 * jamais stocké, et `normalize()` construit un enregistrement en liste blanche.
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
  romeCode: z.string().nullish(),
  typeContrat: z.string().nullish(),
  /** Porte la durée du contrat : « CDD - 12 Mois », « Intérim - 14 Jour(s) », « CDI ». */
  typeContratLibelle: z.string().nullish(),
  /** NAF de l'employeur : la détection d'agence d'intérim (78.*) s'appuie dessus. */
  codeNAF: z.string().nullish(),
  entreprise: z
    .object({
      nom: z.string().nullish(),
      // `siret` n'est jamais renseigné par cette API (0 offre sur 150 observées) :
      // le rapprochement d'entité est donc le chemin normal, pas l'exception.
      siret: z.string().nullish(),
    })
    .nullish(),
  lieuTravail: z
    .object({
      libelle: z.string().nullish(), // « 03 - Gannat »
      codePostal: z.string().nullish(),
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
          parAgenceInterim: parAgence ? 1 : 0,
          datePublication: raw.dateCreation,
          source: "francetravail",
          // Liste blanche stricte : aucune donnée de contact (personne physique).
          payload: { codeNAF: raw.codeNAF ?? null },
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
        romeCode: "N1101",
        typeContrat: "CDI",
        typeContratLibelle: "CDI",
        codeNAF: "43.99C",
        entreprise: { nom: "DEMO BATIMENT BOURBONNAIS", siret: null },
        lieuTravail: { libelle: "03 - Vichy", codePostal: "03200", latitude: 46.127, longitude: 3.426 },
      },
      {
        id: "FIX-FT-2",
        intitule: "Préparateur de commandes (H/F)",
        dateCreation: depuis(4),
        romeCode: "N1103",
        typeContrat: "CDD",
        typeContratLibelle: "CDD - 2 Mois",
        codeNAF: "52.10B",
        entreprise: { nom: "DEMO LOGISTIQUE ALLIER", siret: null },
        lieuTravail: {
          libelle: "03 - Varennes-sur-Allier",
          codePostal: "03150",
          latitude: 46.312,
          longitude: 3.402,
        },
      },
      {
        id: "FIX-FT-3",
        intitule: "Maçon (H/F)",
        dateCreation: depuis(2),
        romeCode: "F1703",
        typeContrat: "MIS",
        typeContratLibelle: "Intérim - 1 Mois",
        codeNAF: "78.20Z",
        entreprise: { nom: "ADECCO BTP VICHY", siret: null },
        lieuTravail: { libelle: "03 - Cusset", codePostal: "03300", latitude: 46.134, longitude: 3.456 },
      },
    ];
  },
};
