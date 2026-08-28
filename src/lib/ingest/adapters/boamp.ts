/**
 * BOAMP — Bulletin officiel des annonces de marchés publics, API Opendatasoft de la DILA.
 * ENDPOINT VÉRIFIÉ le 28/08/2026 par appels réels (voir docs/sources.md) :
 *   GET https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records
 *       ?refine=code_departement:<dept>&where=dateparution>=date'YYYY-MM-DD'
 *       &order_by=dateparution DESC&limit=100&offset=&select=…
 *
 * Pièges vérifiés :
 *   - `code_departement` est un TABLEAU de chaînes SANS zéro initial : « 3 » pour
 *     l'Allier (« 03 » renvoie 0 résultat). Un avis peut porter plusieurs départements.
 *   - `refine=` filtre les tableaux ; `where=` ne sait pas le faire sur ce champ.
 *   - `titulaire`, `type_marche`, `descripteur_libelle` sont des tableaux (avec
 *     doublons possibles dans `titulaire`) — on accepte aussi une chaîne JSON.
 *   - `nature` : APPEL_OFFRE, ATTRIBUTION, RECTIFICATIF, PRE-INFORMATION, ANNULATION…
 *   - Aucun SIRET, aucun montant : le titulaire est publié en clair et rapproché par
 *     raison sociale ; le montant viendra du DECP quelques semaines plus tard.
 *
 * Deux signaux :
 *   - ATTRIBUTION → MARCHE_ATTRIBUE par titulaire, le jour de la parution ;
 *   - APPEL_OFFRE encore ouvert → AO_OUVERT, signal de bassin (aucun SIRET), pour Tempo.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";
import { romesDeLibelleMarche } from "../../reference/metiers";

const BASE = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const limiter = new RateLimiter(5);

const CHAMPS = [
  "id",
  "idweb",
  "dateparution",
  "datelimitereponse",
  "nomacheteur",
  "objet",
  "nature",
  "type_marche",
  "descripteur_libelle",
  "titulaire",
  "code_departement",
  "code_departement_prestation",
  "procedure_libelle",
  "url_avis",
  "famille_libelle",
  "perimetre",
].join(",");

/** Un champ multivalué Opendatasoft : tableau, chaîne JSON, chaîne simple ou nul. */
const liste = z
  .union([z.array(z.union([z.string(), z.number()])), z.string(), z.number(), z.null()])
  .optional()
  .transform((v): string[] => {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === "number") return [String(v)];
    const s = v.trim();
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p)) return p.map(String).map((x) => x.trim()).filter(Boolean);
      } catch {
        // pas du JSON : chaîne simple
      }
    }
    return s ? [s] : [];
  });

export const boampRecordSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  idweb: z.string().nullish(),
  dateparution: z.string(),
  datelimitereponse: z.string().nullish(),
  nomacheteur: z.string().nullish(),
  objet: z.string().nullish(),
  nature: z.string().nullish(),
  type_marche: liste,
  descripteur_libelle: liste,
  titulaire: liste,
  code_departement: liste,
  code_departement_prestation: liste,
  procedure_libelle: z.string().nullish(),
  url_avis: z.string().nullish(),
  famille_libelle: z.string().nullish(),
  perimetre: z.string().nullish(),
});

const pageSchema = z.object({
  total_count: z.number(),
  results: z.array(z.unknown()),
});

export type BoampRaw = z.infer<typeof boampRecordSchema>;

/** « 03 » → « 3 » (tel que stocké par le BOAMP), « 2A »/« 2B » inchangés. */
export function departementBoamp(departement: string): string {
  const d = departement.trim().toUpperCase();
  if (/^2[AB]$/.test(d)) return d;
  return d.replace(/^0+/, "") || d;
}

const TITULAIRES_VIDES = /^(sans suite|non attribu|infructueu|d[ée]clar[ée] sans suite|n[ée]ant|-+)/i;

/** Titulaires dédoublonnés (casse ignorée) et sans mention d'absence d'attribution. */
export function titulairesDe(raw: BoampRaw): string[] {
  const vus = new Set<string>();
  const out: string[] = [];
  for (const t of raw.titulaire) {
    const nom = t.replace(/\s+/g, " ").trim();
    if (!nom || TITULAIRES_VIDES.test(nom)) continue;
    const cle = nom.toUpperCase();
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(nom);
  }
  return out;
}

/** Département sur deux caractères tel que le reste du projet l'écrit (« 3 » → « 03 »). */
function departementProjet(raw: BoampRaw): string | null {
  const d = raw.code_departement_prestation[0] ?? raw.code_departement[0];
  if (!d) return null;
  const u = d.toUpperCase();
  if (/^2[AB]$/.test(u)) return u;
  return u.padStart(2, "0");
}

const JOUR_MS = 86400000;
/** Un appel d'offres reste « ouvert » quelques semaines après sa date limite : l'attribution suit. */
const AO_RECENT_JOURS = 30;

export const boampAdapter: SourceAdapter<BoampRaw> = {
  id: "boamp",

  async *fetch(params: FetchParams): AsyncIterable<BoampRaw> {
    const departement = departementBoamp(params.departement ?? "03");
    const depuis = new Date(Date.now() - (params.depuisJours ?? 90) * JOUR_MS).toISOString().slice(0, 10);

    let offset = 0;
    const limit = 100;
    for (;;) {
      const where = encodeURIComponent(`dateparution>=date'${depuis}'`);
      const url =
        `${BASE}?refine=${encodeURIComponent(`code_departement:${departement}`)}` +
        `&where=${where}&order_by=dateparution%20DESC&limit=${limit}&offset=${offset}` +
        `&select=${encodeURIComponent(CHAMPS)}`;
      const body = pageSchema.parse(await fetchJsonCache("boamp", url, limiter));
      for (const brut of body.results) {
        const parsed = boampRecordSchema.safeParse(brut);
        if (parsed.success) yield parsed.data;
        else throw new Error(`[boamp] réponse inattendue : ${parsed.error.issues[0]?.message}`);
      }
      offset += limit;
      if (offset >= body.total_count || offset >= 9900 || body.results.length < limit) break;
    }
  },

  normalize(raw: BoampRaw): NormalizedRecord[] {
    const nature = (raw.nature ?? "").toUpperCase();
    const idweb = raw.idweb ?? raw.id;
    const occurredAt = `${raw.dateparution.slice(0, 10)}T00:00:00.000Z`;
    const romes = romesDeLibelleMarche([...raw.descripteur_libelle, raw.objet]);
    const departement = departementProjet(raw);

    if (nature === "ATTRIBUTION") {
      return titulairesDe(raw).map((titulaire, index) => ({
        kind: "signal",
        signal: {
          siret: null,
          siren: null,
          type: "MARCHE_ATTRIBUE",
          source: "boamp",
          occurredAt,
          confidence: 0.9,
          payload: {
            objet: raw.objet ?? null,
            acheteurNom: raw.nomacheteur ?? null,
            descripteur: raw.descripteur_libelle,
            typeMarche: raw.type_marche,
            procedure: raw.procedure_libelle ?? null,
            urlAvis: raw.url_avis ?? null,
            titulaire,
            montant: null,
          },
          rawRef: `boamp-${idweb}-${index}`,
          lieu: null,
          romes,
          rapprochement: { denomination: titulaire, departement },
        },
      }));
    }

    if (nature === "APPEL_OFFRE") {
      if (raw.datelimitereponse) {
        const limite = new Date(raw.datelimitereponse).getTime();
        if (Number.isFinite(limite) && limite < Date.now() - AO_RECENT_JOURS * JOUR_MS) return [];
      }
      return [
        {
          kind: "signal",
          signal: {
            siret: null,
            siren: null,
            type: "AO_OUVERT",
            source: "boamp",
            occurredAt,
            confidence: 1,
            payload: {
              objet: raw.objet ?? null,
              acheteurNom: raw.nomacheteur ?? null,
              descripteur: raw.descripteur_libelle,
              typeMarche: raw.type_marche,
              dateLimite: raw.datelimitereponse ?? null,
              procedure: raw.procedure_libelle ?? null,
              urlAvis: raw.url_avis ?? null,
              departement,
            },
            rawRef: `ao-${idweb}`,
            lieu: null,
            romes,
          },
        },
      ];
    }

    return [];
  },

  fixture(): BoampRaw[] {
    const depuis = (j: number) => new Date(Date.now() - j * JOUR_MS).toISOString().slice(0, 10);
    const dans = (j: number) => new Date(Date.now() + j * JOUR_MS).toISOString();
    return [
      {
        id: "26_83186",
        idweb: "26-83186",
        dateparution: depuis(1),
        datelimitereponse: null,
        nomacheteur: "Ville Vichy",
        objet: "NETTOYAGE DES LOCAUX DE DIVERS SITES DE LA VILLE DE VICHY",
        nature: "ATTRIBUTION",
        type_marche: ["SERVICES"],
        descripteur_libelle: ["Nettoyage de locaux"],
        titulaire: ["Saines développement SAS", "Aber propreté azur SAS", "Saines développement SAS"],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Ouverte",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-83186",
        famille_libelle: "Marchés européens",
        perimetre: "DIRECTIVE-24",
      },
      {
        id: "26_83001",
        idweb: "26-83001",
        dateparution: depuis(2),
        datelimitereponse: dans(30),
        nomacheteur: "COMMUNE DE SAINT POURCAIN SUR SIOULE",
        objet: "Travaux d'aménagement de l'entrée Nord de l'agglomération de la Commune de Saint-Pourçain-sur-Sioule",
        nature: "APPEL_OFFRE",
        type_marche: ["TRAVAUX"],
        descripteur_libelle: ["Voirie et réseaux divers"],
        titulaire: [],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Adaptée",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-83001",
        famille_libelle: "Marchés <90 k€ (MAPA)",
        perimetre: "MAPA",
      },
      {
        id: "26_82900",
        idweb: "26-82900",
        dateparution: depuis(3),
        datelimitereponse: null,
        nomacheteur: "VILLE DE MONTLUCON",
        objet: "Mission de maîtrise d'œuvre pour la restauration de l'église Notre-Dame",
        nature: "RECTIFICATIF",
        type_marche: ["SERVICES"],
        descripteur_libelle: ["Maîtrise d'oeuvre"],
        titulaire: [],
        code_departement: ["3"],
        code_departement_prestation: [],
        procedure_libelle: "Procédure Adaptée",
        url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-82900",
        famille_libelle: "Marchés <90 k€ (MAPA)",
        perimetre: "MAPA",
      },
    ];
  },
};
