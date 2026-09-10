/**
 * Ratios financiers INPI / BCE — comptes annuels déposés au greffe, plusieurs
 * exercices par entreprise. API Opendatasoft du ministère de l'Économie, ouverte.
 *
 * ENDPOINT VÉRIFIÉ le 10/09/2026 par appels réels (voir docs/sources.md) :
 *   GET https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/ratios_inpi_bce/records
 *       ?where=siren in ("502657778","327641346")&select=siren,date_cloture_exercice,
 *        chiffre_d_affaires,resultat_net,type_bilan,confidentiality
 *       &order_by=siren,date_cloture_exercice desc&limit=100
 *
 * Pourquoi cette source : l'API Recherche d'entreprises ne renvoie QU'UN exercice
 * par société (vérifié sur six sociétés), donc `ca_precedent` restait toujours
 * vide et ni la tendance du chiffre d'affaires ni le malus de santé ne pouvaient
 * jamais se déclencher. Ici, TRANSARC AQUILON a neuf exercices (2016-2024).
 *
 * Champs vérifiés : siren, date_cloture_exercice (AAAA-MM-JJ), chiffre_d_affaires,
 * resultat_net, marge_brute, ebe, ebit, type_bilan (C complet, S simplifié,
 * K consolidé), confidentiality. Jeu modifié le 01/06/2026.
 */
import { z } from "zod";
import { fetchJsonCache, RateLimiter } from "../http";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "../types";

const BASE = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/ratios_inpi_bce/records";
const limiter = new RateLimiter(5);
/** SIREN par requête : la clause `in` accepte des lots, l'URL reste courte. */
export const LOT = 40;

export const inpiRecordSchema = z.object({
  siren: z.string(),
  date_cloture_exercice: z.string().nullable(),
  chiffre_d_affaires: z.number().nullable().optional(),
  resultat_net: z.number().nullable().optional(),
  type_bilan: z.string().nullable().optional(),
  confidentiality: z.string().nullable().optional(),
});

const pageSchema = z.object({
  total_count: z.number(),
  results: z.array(z.unknown()),
});

export type InpiRaw = z.infer<typeof inpiRecordSchema>;

/** Tous les exercices d'un SIREN, regroupés : un enregistrement brut par entreprise. */
export type InpiEntreprise = { siren: string; exercices: InpiRaw[] };

function annee(dateCloture: string | null): number | null {
  const a = Number((dateCloture ?? "").slice(0, 4));
  return Number.isFinite(a) && a > 1900 ? a : null;
}

/** Un montant à 0 est un « non renseigné », comme chez SIRENE. */
function montantOuNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v !== 0 ? v : null;
}

/**
 * Deux derniers exercices d'une entreprise. À année égale, les comptes sociaux
 * (complets ou simplifiés) priment sur les comptes consolidés, qui agrègent des
 * filiales et n'ont plus rien de local.
 */
export function lireExercices(exercices: InpiRaw[]): {
  caAnnee: number | null;
  ca: number | null;
  caPrecedent: number | null;
  resultatNet: number | null;
  resultatNetPrecedent: number | null;
} {
  const parAnnee = new Map<number, InpiRaw>();
  for (const e of exercices) {
    if (e.confidentiality && e.confidentiality.toLowerCase() !== "public") continue;
    const a = annee(e.date_cloture_exercice);
    if (a == null) continue;
    const deja = parAnnee.get(a);
    if (!deja || (deja.type_bilan === "K" && e.type_bilan !== "K")) parAnnee.set(a, e);
  }
  const annees = [...parAnnee.keys()].sort((x, y) => y - x);
  if (annees.length === 0) {
    return { caAnnee: null, ca: null, caPrecedent: null, resultatNet: null, resultatNetPrecedent: null };
  }
  const dernier = parAnnee.get(annees[0])!;
  const precedent = parAnnee.get(annees[0] - 1) ?? null;
  return {
    caAnnee: annees[0],
    ca: montantOuNull(dernier.chiffre_d_affaires),
    caPrecedent: precedent ? montantOuNull(precedent.chiffre_d_affaires) : null,
    resultatNet: typeof dernier.resultat_net === "number" ? dernier.resultat_net : null,
    resultatNetPrecedent: precedent && typeof precedent.resultat_net === "number" ? precedent.resultat_net : null,
  };
}

export const inpiAdapter: SourceAdapter<InpiEntreprise> = {
  id: "inpi",

  async *fetch(params: FetchParams): AsyncIterable<InpiEntreprise> {
    const sirens = [...new Set((params.sirens ?? []).filter((s) => /^\d{9}$/.test(s)))];
    if (sirens.length === 0) return;

    for (let i = 0; i < sirens.length; i += LOT) {
      const lot = sirens.slice(i, i + LOT);
      const where = `siren in (${lot.map((s) => `"${s}"`).join(",")})`;
      const parSiren = new Map<string, InpiRaw[]>();
      let offset = 0;
      const limit = 100;
      for (;;) {
        const url =
          `${BASE}?where=${encodeURIComponent(where)}` +
          `&select=${encodeURIComponent("siren,date_cloture_exercice,chiffre_d_affaires,resultat_net,type_bilan,confidentiality")}` +
          `&order_by=${encodeURIComponent("siren,date_cloture_exercice desc")}&limit=${limit}&offset=${offset}`;
        const body = pageSchema.parse(await fetchJsonCache("inpi", url, limiter));
        for (const brut of body.results) {
          const parsed = inpiRecordSchema.safeParse(brut);
          if (!parsed.success) throw new Error(`[inpi] réponse inattendue : ${parsed.error.issues[0]?.message}`);
          const liste = parSiren.get(parsed.data.siren) ?? [];
          liste.push(parsed.data);
          parSiren.set(parsed.data.siren, liste);
        }
        offset += limit;
        if (offset >= body.total_count || body.results.length < limit || offset >= 9900) break;
      }
      for (const [siren, exercices] of parSiren) yield { siren, exercices };
    }
  },

  normalize(raw: InpiEntreprise): NormalizedRecord[] {
    const finances = lireExercices(raw.exercices);
    if (finances.caAnnee == null) return [];
    return [{ kind: "finances", siren: raw.siren, source: "inpi", finances }];
  },

  fixture(): InpiEntreprise[] {
    return [
      {
        siren: "900900001",
        exercices: [
          { siren: "900900001", date_cloture_exercice: "2025-12-31", chiffre_d_affaires: 7300000, resultat_net: 250000, type_bilan: "C", confidentiality: "Public" },
          { siren: "900900001", date_cloture_exercice: "2024-12-31", chiffre_d_affaires: 6200000, resultat_net: 210000, type_bilan: "C", confidentiality: "Public" },
          { siren: "900900001", date_cloture_exercice: "2023-12-31", chiffre_d_affaires: 5100000, resultat_net: 140000, type_bilan: "C", confidentiality: "Public" },
        ],
      },
    ];
  },
};
