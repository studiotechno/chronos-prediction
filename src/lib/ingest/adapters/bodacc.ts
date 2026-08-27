/**
 * BODACC — annonces civiles et commerciales, API Opendatasoft de la DILA.
 * ENDPOINT VÉRIFIÉ le 27/08/2026 par appel réel (voir docs/sources.md) :
 *   GET https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/
 *       annonces-commerciales/records?where=...&order_by=dateparution DESC&limit=&offset=
 * Filtres vérifiés : familleavis="collective", numerodepartement (vérifié sur "13", identique pour "03"), registre like "<siren>".
 * Ouverte, sans clé.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const BASE = "https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records";
const limiter = new RateLimiter(5);

export const bodaccRecordSchema = z.object({
  id: z.string(),
  dateparution: z.string(),
  familleavis: z.string(),
  familleavis_lib: z.string().nullable(),
  typeavis_lib: z.string().nullable(),
  numerodepartement: z.string().nullable(),
  tribunal: z.string().nullable(),
  commercant: z.string().nullable(),
  cp: z.string().nullable().optional(),
  ville: z.string().nullable().optional(),
  registre: z.array(z.string()).nullable(),
  /** JSON encodé en chaîne, contient la nature de la procédure ou de la modification. */
  jugement: z.string().nullable().optional(),
  modificationsgenerales: z.string().nullable().optional(),
});

const pageSchema = z.object({
  total_count: z.number(),
  results: z.array(z.unknown()),
});

export type BodaccRaw = z.infer<typeof bodaccRecordSchema>;

function sirenDeRegistre(registre: string[] | null): string | null {
  if (!registre) return null;
  const brut = registre.find((r) => /^\d{9}$/.test(r.replace(/\s/g, "")));
  return brut ? brut.replace(/\s/g, "") : null;
}

/** Nature de la procédure extraite du champ `jugement` (JSON en chaîne). */
function natureProcedure(jugement: string | null | undefined): string {
  if (!jugement) return "procédure collective";
  try {
    const j = JSON.parse(jugement);
    const nature = j?.nature ?? j?.famille;
    if (typeof nature === "string" && nature.length > 0) return nature.toLowerCase();
  } catch {
    // champ non JSON : on garde le libellé générique
  }
  return "procédure collective";
}

export const bodaccAdapter: SourceAdapter<BodaccRaw> = {
  id: "bodacc",

  async *fetch(params: FetchParams): AsyncIterable<BodaccRaw> {
    const departement = params.departement ?? "03";
    const depuis = new Date(Date.now() - (params.depuisJours ?? 90) * 86400000)
      .toISOString()
      .slice(0, 10);

    // Deux familles utiles : procédures collectives (malus) et modifications (capital).
    for (const famille of ["collective", "modification"]) {
      let offset = 0;
      const limit = 100;
      for (;;) {
        const where = encodeURIComponent(
          `familleavis="${famille}" AND numerodepartement="${departement}" AND dateparution>=date'${depuis}'`,
        );
        const url = `${BASE}?where=${where}&order_by=dateparution%20DESC&limit=${limit}&offset=${offset}`;
        const body = pageSchema.parse(await fetchJsonCache("bodacc", url, limiter));
        for (const brut of body.results) {
          const parsed = bodaccRecordSchema.safeParse(brut);
          if (parsed.success) yield parsed.data;
          else throw new Error(`[bodacc] réponse inattendue : ${parsed.error.issues[0]?.message}`);
        }
        offset += limit;
        if (offset >= body.total_count || offset >= 9900) break;
      }
    }
  },

  normalize(raw: BodaccRaw): NormalizedRecord[] {
    const siren = sirenDeRegistre(raw.registre);
    if (!siren) return [];

    if (raw.familleavis === "collective") {
      return [
        {
          kind: "signal",
          signal: {
            siret: null, // rattaché au siège du SIREN par le pas de rattachement
            siren,
            type: "BODACC_RISQUE",
            source: "bodacc",
            occurredAt: `${raw.dateparution}T00:00:00.000Z`,
            confidence: 1,
            payload: {
              procedure: natureProcedure(raw.jugement),
              tribunal: raw.tribunal,
              denomination: raw.commercant,
            },
            rawRef: raw.id,
          },
        },
      ];
    }

    if (raw.familleavis === "modification") {
      // Heuristique documentée : seules les modifications mentionnant le capital nous intéressent.
      const texte = (raw.modificationsgenerales ?? "").toLowerCase();
      if (!texte.includes("capital")) return [];
      const fusion = texte.includes("fusion");
      return [
        {
          kind: "signal",
          signal: {
            siret: null,
            siren,
            type: "BODACC_CAPITAL",
            source: "bodacc",
            occurredAt: `${raw.dateparution}T00:00:00.000Z`,
            confidence: 1,
            payload: {
              typeAnnonce: fusion ? "fusion" : "augmentation_capital",
              denomination: raw.commercant,
            },
            rawRef: raw.id,
          },
        },
      ];
    }

    return [];
  },

  fixture(): BodaccRaw[] {
    return [
      {
        id: "FIX-BODACC-1",
        dateparution: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
        familleavis: "collective",
        familleavis_lib: "Procédures collectives",
        typeavis_lib: "Avis initial",
        numerodepartement: "03",
        tribunal: "TRIBUNAL DE COMMERCE DE CUSSET",
        commercant: "DEMO METALLERIE",
        cp: "03800",
        ville: "Gannat",
        registre: ["900 900 003", "900900003"],
        jugement: JSON.stringify({ nature: "Jugement d'ouverture d'une procédure de redressement judiciaire" }),
        modificationsgenerales: null,
      },
      {
        id: "FIX-BODACC-2",
        dateparution: new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10),
        familleavis: "modification",
        familleavis_lib: "Modifications diverses",
        typeavis_lib: "Avis initial",
        numerodepartement: "03",
        tribunal: "TRIBUNAL DE COMMERCE DE CUSSET",
        commercant: "DEMO LOGISTIQUE ALLIER",
        cp: "03150",
        ville: "Varennes-sur-Allier",
        registre: ["900900002"],
        jugement: null,
        modificationsgenerales: "Augmentation du capital social. Nouveau capital : 500 000 EUR",
      },
    ];
  },
};
