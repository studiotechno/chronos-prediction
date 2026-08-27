/**
 * Enrichissement du référentiel à la demande.
 *
 * Constat fait sur données réelles (Allier, 90 jours) : 71 marchés publics sur 72
 * sont attribués à des entreprises absentes du référentiel, parce que le filtre DECP
 * porte sur le LIEU D'EXÉCUTION alors que le référentiel SIRENE est bâti autour de
 * l'agence et filtré par NAF. Sans enrichissement, le signal MARCHE_ATTRIBUE — l'un
 * des plus forts du modèle — ne score presque personne.
 *
 * On va donc chercher ces établissements un par un chez SIRENE.
 * ENDPOINT VÉRIFIÉ le 27/08/2026 par appel réel :
 *   GET https://recherche-entreprises.api.gouv.fr/search?q=<siret>&per_page=1
 * (voir docs/sources.md)
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";
import { effectifEstime } from "../reference/tranches";
import { fetchJsonCache, RateLimiter } from "./http";
import { sireneResultSchema, type SireneRaw } from "./adapters/sirene";

const BASE = "https://recherche-entreprises.api.gouv.fr";
const limiter = new RateLimiter(5);

const rechercheSchema = z.object({
  results: z.array(z.unknown()),
  total_results: z.number(),
});

async function chercherParSiret(siret: string): Promise<SireneRaw | null> {
  const url = `${BASE}/search?q=${encodeURIComponent(siret)}&per_page=1`;
  const body = rechercheSchema.parse(await fetchJsonCache("sirene", url, limiter));
  if (body.results.length === 0) return null;
  const parsed = sireneResultSchema.safeParse(body.results[0]);
  return parsed.success ? parsed.data : null;
}

export type EnrichStats = { demandes: number; ajoutes: number; introuvables: number };

/**
 * Ajoute au référentiel les SIRET cités par des signaux mais absents de la table
 * `etablissement`. N'écrase jamais un établissement déjà connu.
 */
export async function enrichirSiretsManquants(
  db: BetterSQLite3Database<typeof schema>,
  sirets: string[],
): Promise<EnrichStats> {
  const stats: EnrichStats = { demandes: 0, ajoutes: 0, introuvables: 0 };

  const connus = new Set(
    db.select({ siret: schema.etablissement.siret }).from(schema.etablissement).all().map((r) => r.siret),
  );
  const manquants = [...new Set(sirets)].filter((s) => !connus.has(s));
  stats.demandes = manquants.length;

  for (const siret of manquants) {
    const raw = await chercherParSiret(siret);
    const etab = raw?.matching_etablissements.find((e) => e.siret === siret);
    if (!raw || !etab || !etab.activite_principale) {
      stats.introuvables++;
      continue;
    }

    const denomination = raw.nom_raison_sociale ?? raw.nom_complet;
    db.insert(schema.entreprise)
      .values({
        siren: raw.siren,
        denomination,
        categorie: raw.categorie_entreprise,
        dateCreation: raw.date_creation,
        etat: raw.etat_administratif,
      })
      .onConflictDoUpdate({ target: schema.entreprise.siren, set: { denomination } })
      .run();

    db.insert(schema.etablissement)
      .values({
        siret: etab.siret,
        siren: raw.siren,
        denomination,
        naf: etab.activite_principale,
        trancheEffectif: etab.tranche_effectif_salarie,
        effectifEstime: effectifEstime(etab.tranche_effectif_salarie),
        codePostal: etab.code_postal,
        commune: etab.libelle_commune,
        lat: etab.latitude ? Number(etab.latitude) : null,
        lon: etab.longitude ? Number(etab.longitude) : null,
        dateCreation: etab.date_creation,
        etatAdministratif: etab.etat_administratif,
        estSiege: etab.est_siege ? 1 : 0,
      })
      .onConflictDoNothing()
      .run();
    stats.ajoutes++;
  }

  return stats;
}

/** SIRET cités par des signaux d'un type donné et absents du référentiel. */
export function siretsOrphelins(
  db: BetterSQLite3Database<typeof schema>,
  type: string,
): string[] {
  const connus = new Set(
    db.select({ siret: schema.etablissement.siret }).from(schema.etablissement).all().map((r) => r.siret),
  );
  const orphelins = db
    .select({ siret: schema.signal.siret })
    .from(schema.signal)
    .where(eq(schema.signal.type, type))
    .all()
    .map((r) => r.siret)
    .filter((s): s is string => s != null && !connus.has(s));
  return [...new Set(orphelins)];
}
