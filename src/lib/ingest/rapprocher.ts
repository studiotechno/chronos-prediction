/**
 * Rapprochement d'une raison sociale brute vers un SIRET du référentiel —
 * partagé par toutes les sources qui ne publient pas de SIRET (France Travail,
 * BOAMP). Deux passes, dans cet ordre :
 *   1. le référentiel local, enseignes et noms commerciaux compris (gratuit) ;
 *   2. l'interrogation de SIRENE par nom + département, dont les candidats
 *      repassent par le même scoring. SIRENE apporte le rappel, notre module
 *      garde la décision et la précision.
 *
 * Le référentiel est chargé une fois par exécution (`creerRapprocheur`) : à
 * l'échelle d'un bassin, le recharger à chaque signal coûterait plus que le
 * rapprochement lui-même.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { matchEntity, type CandidatEtab, type MatchCandidat } from "../matching/match";
import { candidatsSirene, enrichirSiretsManquants } from "./enrich";

export type EntiteBrute = {
  denomination: string;
  codePostal?: string | null;
  departement?: string | null;
  naf?: string | null;
};

export type ResultatRapprochement =
  | { decision: "auto"; siret: string; siren: string; confidence: number; viaSirene: boolean; candidat: MatchCandidat }
  | { decision: "ambigu"; candidats: MatchCandidat[] }
  | { decision: "rejet"; meilleur: MatchCandidat | null };

export type Rapprocheur = {
  rapprocher(raw: EntiteBrute, opts?: { sansReseau?: boolean }): Promise<ResultatRapprochement>;
  /** Ajoute un établissement au référentiel en mémoire (après enrichissement). */
  ajouter(c: CandidatEtab): void;
  taille(): number;
};

/**
 * Référentiel de rapprochement : chaque établissement y figure sous sa raison
 * sociale ET sous chacune de ses enseignes / son nom commercial. Les offres
 * parlent d'« Intermarché Cusset », l'INSEE de « SAS CUSDIS ».
 */
async function chargerReferentiel(db: PostgresJsDatabase<typeof schema>): Promise<CandidatEtab[]> {
  const rows = await db
    .select({
      siret: schema.etablissement.siret,
      denomination: schema.etablissement.denomination,
      codePostal: schema.etablissement.codePostal,
      commune: schema.etablissement.commune,
      naf: schema.etablissement.naf,
      enseignes: schema.etablissement.enseignes,
      nomCommercial: schema.etablissement.nomCommercial,
    })
    .from(schema.etablissement);

  const referentiel: CandidatEtab[] = [];
  for (const r of rows) {
    referentiel.push({ siret: r.siret, denomination: r.denomination, codePostal: r.codePostal, commune: r.commune, naf: r.naf });
    const alias = new Set<string>();
    for (const e of r.enseignes ?? []) if (e && e.trim()) alias.add(e.trim());
    if (r.nomCommercial && r.nomCommercial.trim()) alias.add(r.nomCommercial.trim());
    for (const a of alias) {
      if (a.toUpperCase() === r.denomination.toUpperCase()) continue;
      referentiel.push({ siret: r.siret, denomination: a, codePostal: r.codePostal, commune: r.commune, naf: r.naf });
    }
  }
  return referentiel;
}

export async function creerRapprocheur(db: PostgresJsDatabase<typeof schema>): Promise<Rapprocheur> {
  const referentiel = await chargerReferentiel(db);

  return {
    taille: () => referentiel.length,
    ajouter: (c) => {
      referentiel.push(c);
    },
    async rapprocher(raw, opts = {}) {
      const entite = { denomination: raw.denomination, codePostal: raw.codePostal ?? null, naf: raw.naf ?? null };

      // Passe 1 — référentiel local
      const local = matchEntity(entite, referentiel);
      if (local.decision === "auto") {
        return {
          decision: "auto",
          siret: local.candidat.siret,
          siren: local.candidat.siret.slice(0, 9),
          confidence: local.candidat.similarite,
          viaSirene: false,
          candidat: local.candidat,
        };
      }

      // Passe 2 — SIRENE par nom + département
      const departement = raw.departement ?? raw.codePostal?.slice(0, 2) ?? null;
      const distants = !opts.sansReseau && departement ? await candidatsSirene(raw.denomination, departement) : [];
      const distant = distants.length > 0 ? matchEntity(entite, distants) : null;

      if (distant?.decision === "auto") {
        await enrichirSiretsManquants(db, [distant.candidat.siret]);
        referentiel.push(distant.candidat);
        return {
          decision: "auto",
          siret: distant.candidat.siret,
          siren: distant.candidat.siret.slice(0, 9),
          confidence: distant.candidat.similarite,
          viaSirene: true,
          candidat: distant.candidat,
        };
      }

      const candidats =
        distant?.decision === "ambigu"
          ? distant.candidats
          : local.decision === "ambigu"
            ? local.candidats
            : [];
      if (candidats.length > 0) return { decision: "ambigu", candidats };
      return { decision: "rejet", meilleur: local.decision === "rejet" ? local.meilleur : null };
    },
  };
}
