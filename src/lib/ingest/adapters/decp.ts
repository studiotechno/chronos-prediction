/**
 * DECP — données essentielles de la commande publique (marchés attribués).
 * ENDPOINT VÉRIFIÉ le 27/08/2026 par appel réel (voir docs/sources.md) :
 *   GET https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/
 *       decp-2022-marches-valides/records?where=...&order_by=datenotification DESC
 * Champs vérifiés : objet, codecpv, montant, datenotification, dureemois,
 * titulaire_id_1..3 (+ titulaire_typeidentifiant_N = "SIRET"), acheteur_id,
 * lieuexecution_code / lieuexecution_typecode.
 * Le SIRET du titulaire est généralement présent : confidence 1, pas de rapprochement flou.
 *
 * Lieu d'exécution (VÉRIFIÉ le 10/09/2026) : le filtre du V2 ne retenait que les
 * marchés codés au DÉPARTEMENT (« Code département »). Or sur l'Allier depuis
 * juin 2026, 76 marchés étaient codés ainsi et 187 au CODE POSTAL — 71 % des
 * marchés perdus, et précisément ceux qui portent un lieu du besoin exploitable.
 * Le filtre couvre désormais les trois codages (département, code postal, code
 * commune), et le code postal ou la commune est géocodé en lieu du besoin.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";
import { nombreFini } from "../nombre";
import { romesDeCpv } from "../../reference/metiers";
import { geocoderCommune } from "../geocode";
import type { SignalLieu } from "../types";

const BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/decp-2022-marches-valides/records";
const limiter = new RateLimiter(5);

const champ = z.union([z.string(), z.number()]).nullable().optional();

export const decpRecordSchema = z.object({
  id: z.union([z.string(), z.number()]),
  objet: z.string().nullable(),
  codecpv: z.string().nullable(),
  montant: z.number().nullable(),
  dureemois: z.union([z.string(), z.number()]).nullable(),
  datenotification: z.string().nullable(),
  acheteur_id: champ,
  titulaire_id_1: champ,
  titulaire_typeidentifiant_1: champ,
  titulaire_id_2: champ,
  titulaire_typeidentifiant_2: champ,
  titulaire_id_3: champ,
  titulaire_typeidentifiant_3: champ,
  lieuexecution_code: champ,
  lieuexecution_typecode: champ,
});

const pageSchema = z.object({
  total_count: z.number(),
  results: z.array(z.unknown()),
});

export type DecpRaw = z.infer<typeof decpRecordSchema> & {
  /** Lieu d'exécution géocodé à la lecture (code postal ou commune). */
  lieu?: SignalLieu | null;
};

/** Clause ODSQL couvrant les trois codages du lieu d'exécution pour un département. */
export function clauseLieu(departement: string): string {
  const d = departement.replace(/"/g, "");
  return (
    `((lieuexecution_code="${d}" and lieuexecution_typecode="Code département") or ` +
    `(startswith(lieuexecution_code,"${d}") and lieuexecution_typecode in ("Code postal","Code commune")))`
  );
}

/** Lieu du besoin d'un marché codé au code postal ou à la commune. */
export async function lieuDuMarche(raw: DecpRaw): Promise<SignalLieu | null> {
  const code = raw.lieuexecution_code != null ? String(raw.lieuexecution_code).trim() : "";
  const type = raw.lieuexecution_typecode != null ? String(raw.lieuexecution_typecode) : "";
  if (!/^\d{5}$/.test(code)) return null;
  const point =
    type === "Code postal"
      ? await geocoderCommune({ codePostal: code })
      : type === "Code commune"
        ? await geocoderCommune({ codeInsee: code })
        : null;
  return point ? { lat: point.lat, lon: point.lon, libelle: point.libelle || null } : null;
}

export const decpAdapter: SourceAdapter<DecpRaw> = {
  id: "decp",

  async *fetch(params: FetchParams): AsyncIterable<DecpRaw> {
    const departement = params.departement ?? "03";
    const depuis = new Date(Date.now() - (params.depuisJours ?? 90) * 86400000)
      .toISOString()
      .slice(0, 10);

    let offset = 0;
    const limit = 100;
    for (;;) {
      const where = encodeURIComponent(`${clauseLieu(departement)} and datenotification>=date'${depuis}'`);
      const url = `${BASE}?where=${where}&order_by=datenotification%20DESC&limit=${limit}&offset=${offset}`;
      const body = pageSchema.parse(await fetchJsonCache("decp", url, limiter));
      for (const brut of body.results) {
        const parsed = decpRecordSchema.safeParse(brut);
        if (!parsed.success) throw new Error(`[decp] réponse inattendue : ${parsed.error.issues[0]?.message}`);
        yield { ...parsed.data, lieu: await lieuDuMarche(parsed.data) };
      }
      offset += limit;
      if (offset >= body.total_count || offset >= 9900) break;
    }
  },

  normalize(raw: DecpRaw): NormalizedRecord[] {
    if (!raw.datenotification) return [];
    const records: NormalizedRecord[] = [];
    const titulaires: [unknown, unknown][] = [
      [raw.titulaire_id_1, raw.titulaire_typeidentifiant_1],
      [raw.titulaire_id_2, raw.titulaire_typeidentifiant_2],
      [raw.titulaire_id_3, raw.titulaire_typeidentifiant_3],
    ];
    for (const [id, typeId] of titulaires) {
      if (typeId !== "SIRET" || typeof id !== "string" || !/^\d{14}$/.test(id)) continue;
      records.push({
        kind: "signal",
        signal: {
          siret: id,
          siren: id.slice(0, 9),
          type: "MARCHE_ATTRIBUE",
          source: "decp",
          occurredAt: `${raw.datenotification}T00:00:00.000Z`,
          confidence: 1,
          payload: {
            objet: raw.objet,
            montant: raw.montant,
            cpv: raw.codecpv,
            acheteur: raw.acheteur_id != null ? String(raw.acheteur_id) : null,
            dureeMois: nombreFini(raw.dureemois),
            lieuExecutionCode: raw.lieuexecution_code != null ? String(raw.lieuexecution_code) : null,
            lieuExecutionType: raw.lieuexecution_typecode != null ? String(raw.lieuexecution_typecode) : null,
          },
          rawRef: `${raw.id}-${id}`,
          lieu: raw.lieu ?? null,
          // Métiers induits par le CPV : ce que le chantier va demander.
          romes: romesDeCpv(raw.codecpv),
        },
      });
    }
    return records;
  },

  fixture(): DecpRaw[] {
    const depuis = (j: number) => new Date(Date.now() - j * 86400000).toISOString().slice(0, 10);
    return [
      {
        id: "FIX-DECP-1",
        objet: "Travaux de réfection de voirie communale",
        codecpv: "45233140-2",
        montant: 480000,
        dureemois: 6,
        datenotification: depuis(24),
        acheteur_id: "21130001800012",
        titulaire_id_1: "90090000100019",
        titulaire_typeidentifiant_1: "SIRET",
        titulaire_id_2: null,
        titulaire_typeidentifiant_2: null,
        titulaire_id_3: null,
        titulaire_typeidentifiant_3: null,
        lieuexecution_code: "03200",
        lieuexecution_typecode: "Code postal",
      },
      {
        id: "FIX-DECP-2",
        objet: "Prestations de nettoyage des bâtiments municipaux",
        codecpv: "90911200-8",
        montant: 120000,
        dureemois: 12,
        datenotification: depuis(10),
        acheteur_id: "21130001800012",
        titulaire_id_1: "90090000200018",
        titulaire_typeidentifiant_1: "SIRET",
        titulaire_id_2: null,
        titulaire_typeidentifiant_2: null,
        titulaire_id_3: null,
        titulaire_typeidentifiant_3: null,
        lieuexecution_code: "03",
        lieuexecution_typecode: "Code département",
      },
    ];
  },
};
