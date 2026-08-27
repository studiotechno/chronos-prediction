/**
 * France Travail — API Offres d'emploi v2.
 *
 * ENDPOINT NON VÉRIFIÉ : l'accès exige un compte francetravail.io (OAuth2
 * client_credentials) que ce projet n'a pas encore. Conformément à la règle
 * absolue du projet (« ne devine jamais une URL d'API »), fetch() ÉCHOUE
 * explicitement tant que l'endpoint n'a pas été vérifié par un appel réel.
 * La marche à suivre est documentée dans docs/sources.md ; normalize() et
 * fixture() sont complets et testés, il ne restera qu'à écrire la boucle
 * d'appel une fois la clé disponible.
 */
import { z } from "zod";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

/** Schéma d'une offre, construit d'après la documentation francetravail.io — à
 *  confirmer sur données réelles au premier appel authentifié. */
export const ftOffreSchema = z.object({
  id: z.string(),
  intitule: z.string(),
  dateCreation: z.string(),
  romeCode: z.string().nullable().optional(),
  typeContrat: z.string().nullable().optional(), // CDI, CDD, MIS...
  dureeTravailLibelle: z.string().nullable().optional(),
  entreprise: z
    .object({
      nom: z.string().nullable().optional(),
      siret: z.string().nullable().optional(),
      entrepriseAdaptee: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  lieuTravail: z
    .object({
      libelle: z.string().nullable().optional(),
      codePostal: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type FtOffreRaw = z.infer<typeof ftOffreSchema>;

/** Enseignes d'agences d'intérim : heuristique quand le NAF de l'annonceur est inconnu. */
const MOTIFS_AGENCES = [
  "adecco", "manpower", "randstad", "proman", "crit ", "crit interim", "synergie",
  "actual", "temporis", "start people", "supplay", "leader intérim", "interaction",
  "triangle", "aquila rh", "welljob", "job link",
];

export function estAgenceInterim(nom: string | null | undefined, typeContrat: string | null | undefined): boolean {
  if (typeContrat === "MIS") return true;
  if (!nom) return false;
  const bas = nom.toLowerCase();
  return MOTIFS_AGENCES.some((m) => bas.includes(m));
}

function dureeContratJours(libelle: string | null | undefined): number | null {
  if (!libelle) return null;
  const mois = libelle.match(/(\d+)\s*mois/i);
  if (mois) return Number(mois[1]) * 30;
  const jours = libelle.match(/(\d+)\s*jour/i);
  if (jours) return Number(jours[1]);
  return null;
}

export const francetravailAdapter: SourceAdapter<FtOffreRaw> = {
  id: "francetravail",

  async *fetch(params: FetchParams): AsyncIterable<FtOffreRaw> {
    void params;
    throw new Error(
      "[francetravail] endpoint non vérifié, voir docs/sources.md — " +
        "créez un compte sur https://francetravail.io, renseignez FRANCETRAVAIL_CLIENT_ID / " +
        "FRANCETRAVAIL_CLIENT_SECRET dans .env, puis vérifiez l'endpoint par un appel réel " +
        "avant d'implémenter cette boucle. En attendant : npm run demo (fixtures).",
    );
  },

  normalize(raw: FtOffreRaw): NormalizedRecord[] {
    const parAgence = estAgenceInterim(raw.entreprise?.nom, raw.typeContrat);
    return [
      {
        kind: "offre",
        offre: {
          id: raw.id,
          siret: raw.entreprise?.siret ?? null,
          entrepriseNom: raw.entreprise?.nom ?? null,
          intitule: raw.intitule,
          typeContrat: raw.typeContrat ?? null,
          dureeContratJours: dureeContratJours(raw.dureeTravailLibelle),
          rome: raw.romeCode ?? null,
          codePostal: raw.lieuTravail?.codePostal ?? null,
          commune: raw.lieuTravail?.libelle ?? null,
          parAgenceInterim: parAgence ? 1 : 0,
          datePublication: raw.dateCreation,
          source: "francetravail",
          payload: {},
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
        dureeTravailLibelle: null,
        entreprise: { nom: "DEMO BATIMENT BOURBONNAIS", siret: "90090000100019" },
        lieuTravail: { libelle: "VICHY", codePostal: "03200" },
      },
      {
        id: "FIX-FT-2",
        intitule: "Préparateur de commandes (H/F)",
        dateCreation: depuis(4),
        romeCode: "N1103",
        typeContrat: "CDD",
        dureeTravailLibelle: "2 mois",
        entreprise: { nom: "DEMO LOGISTIQUE ALLIER", siret: "90090000200018" },
        lieuTravail: { libelle: "VARENNES-SUR-ALLIER", codePostal: "03150" },
      },
      {
        id: "FIX-FT-3",
        intitule: "Maçon (H/F)",
        dateCreation: depuis(2),
        romeCode: "F1703",
        typeContrat: "MIS",
        dureeTravailLibelle: "1 mois",
        entreprise: { nom: "ADECCO BTP VICHY", siret: null },
        lieuTravail: { libelle: "CUSSET", codePostal: "03300" },
      },
    ];
  },
};
