/**
 * Enrichissement du référentiel à la demande.
 *
 * Constat fait sur données réelles (Allier, 90 jours) : 71 marchés publics sur 72
 * sont attribués à des entreprises absentes du référentiel, parce que le filtre DECP
 * porte sur le LIEU D'EXÉCUTION alors que le référentiel SIRENE est bâti autour de
 * l'agence et filtré par NAF. Même chose pour les 446 annonces BODACC du
 * département : sans enrichissement, ces signaux ne scorent presque personne.
 *
 * On va donc chercher ces entreprises une par une chez SIRENE.
 * ENDPOINTS VÉRIFIÉS le 28/08/2026 par appel réel :
 *   GET https://recherche-entreprises.api.gouv.fr/search?q=<siret>&per_page=1
 *       &minimal=true&include=finances,complements,siege,matching_etablissements
 *       → l'établissement demandé est dans `matching_etablissements` ;
 *   GET …/search?q=<siren>&… → `matching_etablissements` est VIDE, le siège est dans `siege`.
 * (voir docs/sources.md)
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { fetchJsonCache, RateLimiter } from "./http";
import { fusionFinancesSql } from "./run";
import { INCLUDE, normaliserResultat, sireneResultSchema, type SireneRaw } from "./adapters/sirene";
import type { CandidatEtab } from "../matching/match";
import type { EntrepriseRecord, EtablissementFields } from "./types";

const BASE = "https://recherche-entreprises.api.gouv.fr";
const limiter = new RateLimiter(5);

const rechercheSchema = z.object({
  results: z.array(z.unknown()),
  total_results: z.number(),
});

/** Recherche par identifiant (SIRET ou SIREN), avec les compléments (finances, IDCC, siège). */
async function chercherParIdentifiant(identifiant: string): Promise<SireneRaw | null> {
  const url = `${BASE}/search?q=${encodeURIComponent(identifiant)}&per_page=1&minimal=true&include=${INCLUDE}`;
  const body = rechercheSchema.parse(await fetchJsonCache("sirene", url, limiter));
  if (body.results.length === 0) return null;
  const parsed = sireneResultSchema.safeParse(body.results[0]);
  return parsed.success ? parsed.data : null;
}

export type EnrichStats = { demandes: number; ajoutes: number; introuvables: number };

/**
 * Écrit une entreprise et un de ses établissements dans le référentiel.
 * L'entreprise est mise à jour (ses finances et IDCC arrivent ici pour la première
 * fois), l'établissement n'est jamais écrasé s'il existe déjà.
 */
async function ecrire(
  db: PostgresJsDatabase<typeof schema>,
  entreprise: EntrepriseRecord,
  etab: EtablissementFields,
): Promise<void> {
  await db
    .insert(schema.entreprise)
    .values(entreprise)
    .onConflictDoUpdate({
      target: schema.entreprise.siren,
      set: {
        denomination: entreprise.denomination,
        categorie: entreprise.categorie,
        etat: entreprise.etat,
        caractereEmployeur: entreprise.caractereEmployeur ?? null,
        nbEtabsOuverts: entreprise.nbEtabsOuverts ?? null,
        ...fusionFinancesSql(),
        idcc: entreprise.idcc ?? null,
        complements: entreprise.complements ?? null,
      },
    });
  await db.insert(schema.etablissement).values(etab).onConflictDoNothing();
}

/**
 * Ajoute au référentiel les SIRET cités par des signaux mais absents de la table
 * `etablissement`. N'écrase jamais un établissement déjà connu.
 */
export async function enrichirSiretsManquants(
  db: PostgresJsDatabase<typeof schema>,
  sirets: string[],
): Promise<EnrichStats> {
  const stats: EnrichStats = { demandes: 0, ajoutes: 0, introuvables: 0 };

  const connus = new Set(
    (await db.select({ siret: schema.etablissement.siret }).from(schema.etablissement)).map(
      (r) => r.siret,
    ),
  );
  const manquants = [...new Set(sirets)].filter((s) => !connus.has(s));
  stats.demandes = manquants.length;

  for (const siret of manquants) {
    const raw = await chercherParIdentifiant(siret);
    const lu = raw ? normaliserResultat(raw) : null;
    const etab = lu?.etablissements.find((e) => e.siret === siret);
    if (!lu || !etab) {
      stats.introuvables++;
      continue;
    }
    await ecrire(db, lu.entreprise, etab);
    stats.ajoutes++;
  }

  return stats;
}

/**
 * Ajoute au référentiel le SIÈGE des SIREN cités par des signaux (BODACC, accords)
 * mais inconnus de la table `entreprise` — ou connus sans aucun établissement.
 */
export async function enrichirSirensManquants(
  db: PostgresJsDatabase<typeof schema>,
  sirens: string[],
): Promise<EnrichStats> {
  const stats: EnrichStats = { demandes: 0, ajoutes: 0, introuvables: 0 };

  const avecEtab = new Set(
    (await db.select({ siren: schema.etablissement.siren }).from(schema.etablissement)).map((r) => r.siren),
  );
  const manquants = [...new Set(sirens)].filter((s) => /^\d{9}$/.test(s) && !avecEtab.has(s));
  stats.demandes = manquants.length;

  for (const siren of manquants) {
    const raw = await chercherParIdentifiant(siren);
    const lu = raw ? normaliserResultat(raw) : null;
    const siege = lu?.etablissements.find((e) => e.estSiege === 1) ?? lu?.etablissements[0];
    if (!lu || !siege) {
      stats.introuvables++;
      continue;
    }
    await ecrire(db, lu.entreprise, siege);
    stats.ajoutes++;
  }

  return stats;
}

/** SIRET cités par des signaux d'un type donné et absents du référentiel. */
export async function siretsOrphelins(
  db: PostgresJsDatabase<typeof schema>,
  type: string,
): Promise<string[]> {
  const [etabs, signaux] = await Promise.all([
    db.select({ siret: schema.etablissement.siret }).from(schema.etablissement),
    db.select({ siret: schema.signal.siret }).from(schema.signal).where(eq(schema.signal.type, type)),
  ]);
  const connus = new Set(etabs.map((r) => r.siret));
  const orphelins = signaux
    .map((r) => r.siret)
    .filter((s): s is string => s != null && !connus.has(s));
  return [...new Set(orphelins)];
}

// ---------------------------------------------------------------------------
// Résolution par interrogation de SIRENE
// ---------------------------------------------------------------------------

/**
 * Cherche des candidats chez SIRENE à partir d'une raison sociale et d'un
 * département.
 *
 * ENDPOINT VÉRIFIÉ le 28/08/2026 par appel réel :
 *   GET https://recherche-entreprises.api.gouv.fr/search?q=<nom>&departement=<dd>&per_page=5
 *       &minimal=true&include=siege,matching_etablissements
 *
 * Pourquoi ne pas se contenter du référentiel local : celui-ci est bâti autour de
 * l'agence et filtré par NAF, il rate donc les employeurs dont le siège est ailleurs
 * dans le département. Mesuré sur l'Allier, le rapprochement local seul n'attachait
 * que 33 offres sur 2 211. SIRENE fait le gros du rappel, notre module de matching
 * garde la décision et la précision.
 *
 * Chaque établissement est proposé sous sa raison sociale ET sous ses enseignes
 * (« INTERMARCHE » pour la SAS DUNE) : c'est sous l'enseigne que l'offre le nomme.
 *
 * Le filtre `code_postal` a été essayé et écarté : trop strict, le code postal de
 * l'offre est celui du lieu de travail, pas celui du siège (0 résultat sur des
 * entreprises pourtant existantes).
 */
export async function candidatsSirene(
  nom: string,
  departement: string,
): Promise<CandidatEtab[]> {
  const url =
    `${BASE}/search?q=${encodeURIComponent(nom)}` +
    `&departement=${encodeURIComponent(departement)}&per_page=5` +
    `&minimal=true&include=siege,matching_etablissements`;

  let body: unknown;
  try {
    body = await fetchJsonCache("sirene", url, limiter);
  } catch {
    return []; // une résolution ratée ne doit jamais interrompre une ingestion
  }

  const page = rechercheSchema.safeParse(body);
  if (!page.success) return [];

  const candidats: CandidatEtab[] = [];
  for (const brut of page.data.results) {
    const parsed = sireneResultSchema.safeParse(brut);
    if (!parsed.success) continue;
    const raw = parsed.data;
    const denomination = raw.nom_raison_sociale ?? raw.nom_complet;
    const etabs = raw.matching_etablissements.length > 0 ? raw.matching_etablissements : raw.siege ? [raw.siege] : [];
    for (const e of etabs) {
      if (!e.activite_principale || e.etat_administratif === "F") continue;
      const base = { siret: e.siret, codePostal: e.code_postal, commune: e.libelle_commune, naf: e.activite_principale };
      candidats.push({ ...base, denomination });
      const alias = new Set<string>();
      for (const ens of e.liste_enseignes ?? []) if (ens?.trim()) alias.add(ens.trim());
      if (e.nom_commercial?.trim()) alias.add(e.nom_commercial.trim());
      for (const a of alias) {
        if (a.toUpperCase() === denomination.toUpperCase()) continue;
        candidats.push({ ...base, denomination: a });
      }
    }
  }
  return candidats;
}

/** Insère un établissement issu d'une résolution SIRENE dans le référentiel. */
export async function insererDepuisSirene(
  db: PostgresJsDatabase<typeof schema>,
  siret: string,
): Promise<boolean> {
  const stats = await enrichirSiretsManquants(db, [siret]);
  return stats.ajoutes > 0;
}
