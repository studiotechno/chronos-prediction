/**
 * Exécuteur d'ingestion : itère un adapter, valide/normalise, écrit en base
 * de façon idempotente (unicité signal(source, raw_ref)), journalise dans
 * ingestion_run.
 *
 * Dérivées calculées ici, au moment où la donnée de référence change :
 *   · EFFECTIF_UP au ré-import SIRENE, quand la tranche stockée diffère ;
 *   · CA_CROISSANCE / CA_BAISSE quand deux exercices sont connus (RNE).
 *
 * Un signal qui arrive sans SIRET mais avec une raison sociale (titulaire BOAMP)
 * passe par le rapprocheur partagé ; ambigu, il va en file de résolution.
 */
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import * as schema from "../db/schema";
import { trancheRank } from "../reference/tranches";
import type { FetchParams, NormalizedRecord, SourceAdapter } from "./types";
import type { IngestionError } from "../db/schema";
import { creerRapprocheur, type Rapprocheur } from "./rapprocher";

export type RunStats = {
  recordsIn: number;
  recordsOut: number;
  erreurs: IngestionError[];
  /** Rapprochements des signaux sans SIRET (BOAMP…). */
  rapprochement: { autos: number; autosViaSirene: number; ambigus: number; rejets: number };
};

/** Variation relative de CA à partir de laquelle on dérive un signal. */
const SEUIL_CA = 0.15;

export async function runIngestion<TRaw>(
  db: PostgresJsDatabase<typeof schema>,
  adapter: SourceAdapter<TRaw>,
  params: FetchParams,
): Promise<RunStats> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  await db
    .insert(schema.ingestionRun)
    .values({ id: runId, source: adapter.id, startedAt, recordsIn: 0, recordsOut: 0, errors: [] });

  const stats: RunStats = {
    recordsIn: 0,
    recordsOut: 0,
    erreurs: [],
    rapprochement: { autos: 0, autosViaSirene: 0, ambigus: 0, rejets: 0 },
  };
  let rapprocheur: Rapprocheur | null = null;
  const obtenirRapprocheur = async () => (rapprocheur ??= await creerRapprocheur(db));

  try {
    for await (const raw of adapter.fetch(params)) {
      stats.recordsIn++;
      let records: NormalizedRecord[];
      try {
        records = adapter.normalize(raw);
      } catch (e) {
        stats.erreurs.push({ message: e instanceof Error ? e.message : String(e) });
        continue;
      }
      for (const record of records) {
        try {
          if (await appliquer(db, record, stats, obtenirRapprocheur)) stats.recordsOut++;
        } catch (e) {
          stats.erreurs.push({ message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
  } finally {
    await db
      .update(schema.ingestionRun)
      .set({
        finishedAt: new Date().toISOString(),
        recordsIn: stats.recordsIn,
        recordsOut: stats.recordsOut,
        errors: stats.erreurs.slice(0, 100),
      })
      .where(eq(schema.ingestionRun.id, runId));
  }

  return stats;
}

function estTrancheConnue(t: string | null | undefined): boolean {
  return !!t && t !== "NN";
}

/** Applique un enregistrement normalisé. Renvoie true si quelque chose a été écrit. */
async function appliquer(
  db: PostgresJsDatabase<typeof schema>,
  record: NormalizedRecord,
  stats: RunStats,
  obtenirRapprocheur: () => Promise<Rapprocheur>,
): Promise<boolean> {
  const nowIso = new Date().toISOString();

  if (record.kind === "etablissement") {
    const { entreprise, etablissement } = record;

    await db
      .insert(schema.entreprise)
      .values(entreprise)
      .onConflictDoUpdate({
        target: schema.entreprise.siren,
        set: {
          denomination: entreprise.denomination,
          categorie: entreprise.categorie,
          etat: entreprise.etat,
          ...(entreprise.caractereEmployeur !== undefined && { caractereEmployeur: entreprise.caractereEmployeur }),
          ...(entreprise.nbEtabsOuverts !== undefined && { nbEtabsOuverts: entreprise.nbEtabsOuverts }),
          ...(entreprise.caAnnee !== undefined && { caAnnee: entreprise.caAnnee }),
          ...(entreprise.ca !== undefined && { ca: entreprise.ca }),
          ...(entreprise.caPrecedent !== undefined && { caPrecedent: entreprise.caPrecedent }),
          ...(entreprise.resultatNet !== undefined && { resultatNet: entreprise.resultatNet }),
          ...(entreprise.resultatNetPrecedent !== undefined && {
            resultatNetPrecedent: entreprise.resultatNetPrecedent,
          }),
          ...(entreprise.idcc !== undefined && { idcc: entreprise.idcc }),
          ...(entreprise.complements !== undefined && { complements: entreprise.complements }),
        },
      });

    // Dérivée CA_CROISSANCE / CA_BAISSE : deux exercices connus (idempotent par rawRef)
    if (
      entreprise.ca != null &&
      entreprise.caPrecedent != null &&
      entreprise.caPrecedent > 0 &&
      entreprise.caAnnee != null
    ) {
      const delta = (entreprise.ca - entreprise.caPrecedent) / entreprise.caPrecedent;
      if (Math.abs(delta) >= SEUIL_CA) {
        await db
          .insert(schema.signal)
          .values({
            id: crypto.randomUUID(),
            siret: etablissement.estSiege ? etablissement.siret : null,
            siren: entreprise.siren,
            type: delta > 0 ? "CA_CROISSANCE" : "CA_BAISSE",
            source: "sirene",
            // Les comptes d'un exercice se déposent au milieu de l'année suivante.
            occurredAt: `${entreprise.caAnnee + 1}-07-01T00:00:00.000Z`,
            ingestedAt: nowIso,
            confidence: 1,
            payload: {
              annee: entreprise.caAnnee,
              ca: entreprise.ca,
              caPrecedent: entreprise.caPrecedent,
              deltaPct: Math.round(delta * 1000) / 10,
            },
            rawRef: `ca-${entreprise.siren}-${entreprise.caAnnee}`,
          })
          .onConflictDoNothing();
      }
    }

    const existant = (
      await db
        .select()
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siret, etablissement.siret))
    )[0];

    // Dérivée EFFECTIF_UP : passage à une tranche supérieure entre deux imports
    if (
      estTrancheConnue(existant?.trancheEffectif) &&
      estTrancheConnue(etablissement.trancheEffectif) &&
      trancheRank(etablissement.trancheEffectif!) > trancheRank(existant!.trancheEffectif!)
    ) {
      await db
        .insert(schema.signal)
        .values({
          id: crypto.randomUUID(),
          siret: etablissement.siret,
          siren: etablissement.siren,
          type: "EFFECTIF_UP",
          source: "sirene",
          occurredAt: nowIso,
          ingestedAt: nowIso,
          confidence: 1,
          payload: {
            trancheAvant: existant!.trancheEffectif,
            trancheApres: etablissement.trancheEffectif,
          },
          rawRef: `effectif-${etablissement.siret}-${etablissement.trancheEffectif}`,
        })
        .onConflictDoNothing();
    }

    // Une tranche vue chez France Travail ne s'efface pas par un « NN » de l'INSEE.
    const garderTrancheFT =
      existant?.trancheEffectifSource === "francetravail" && !estTrancheConnue(etablissement.trancheEffectif);
    const valeurs = {
      ...etablissement,
      trancheEffectifSource: estTrancheConnue(etablissement.trancheEffectif)
        ? (etablissement.trancheEffectifSource ?? "sirene")
        : null,
      // Attributs posés par d'autres sources (ICPE, LBB) : jamais écrasés par un ré-import SIRENE.
      icpe: existant?.icpe ?? 0,
      icpeRegime: existant?.icpeRegime ?? null,
      lbbScore: existant?.lbbScore ?? null,
      lbbMaj: existant?.lbbMaj ?? null,
    };
    if (garderTrancheFT) {
      valeurs.trancheEffectif = existant!.trancheEffectif;
      valeurs.trancheEffectifSource = existant!.trancheEffectifSource;
      valeurs.effectifEstime = existant!.effectifEstime;
    }

    await db
      .insert(schema.etablissement)
      .values(valeurs)
      .onConflictDoUpdate({ target: schema.etablissement.siret, set: { ...valeurs } });
    return true;
  }

  if (record.kind === "signal") {
    const { rapprochement, ...signal } = record.signal;

    // Rapprochement par raison sociale (source sans SIRET).
    let resolutionEnAttente: { candidats: schema.CandidatResolution[] } | null = null;
    if (!signal.siret && rapprochement?.denomination) {
      const r = await (await obtenirRapprocheur()).rapprocher(rapprochement);
      if (r.decision === "auto") {
        signal.siret = r.siret;
        signal.siren = r.siren;
        signal.confidence = Math.min(signal.confidence, r.confidence);
        stats.rapprochement.autos++;
        if (r.viaSirene) stats.rapprochement.autosViaSirene++;
      } else if (r.decision === "ambigu") {
        stats.rapprochement.ambigus++;
        resolutionEnAttente = {
          candidats: r.candidats.map((c) => ({
            siret: c.siret,
            denomination: c.denomination,
            commune: c.commune,
            naf: c.naf,
            similarite: c.similarite,
          })),
        };
      } else {
        stats.rapprochement.rejets++;
      }
    }

    // Rattachement SIREN → siège : un signal BODACC ne porte qu'un SIREN.
    // On l'accroche au siège si l'entreprise est dans le référentiel du bassin,
    // sinon il reste sans SIRET — le scoring le rattachera si l'entreprise arrive plus tard.
    if (!signal.siret && signal.siren) {
      const etabs = await db
        .select({ siret: schema.etablissement.siret, estSiege: schema.etablissement.estSiege })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siren, signal.siren));
      signal.siret = etabs.find((e) => e.estSiege === 1)?.siret ?? etabs[0]?.siret ?? null;
    }

    const id = crypto.randomUUID();
    // `returning` est la façon portable de savoir si le conflit a mordu :
    // PostgreSQL ne renvoie rien quand ON CONFLICT DO NOTHING a joué.
    const inseres = await db
      .insert(schema.signal)
      .values({ id, ingestedAt: nowIso, ...signal })
      .onConflictDoNothing()
      .returning({ id: schema.signal.id });

    if (inseres.length > 0 && resolutionEnAttente && rapprochement) {
      await db
        .insert(schema.resolutionQueue)
        .values({
          id: `match-${signal.source}-${signal.rawRef}`.slice(0, 120),
          source: signal.source,
          rawDenomination: rapprochement.denomination,
          rawCodePostal: rapprochement.codePostal ?? null,
          rawNaf: rapprochement.naf ?? null,
          candidats: resolutionEnAttente.candidats,
          statut: "en_attente",
          resolvedSiret: null,
          signalId: id,
          createdAt: nowIso,
        })
        .onConflictDoNothing();
    }
    return inseres.length > 0;
  }

  if (record.kind === "offre") {
    const o = record.offre;
    const existante = (
      await db
        .select({
          id: schema.offreBrute.id,
          dateActualisation: schema.offreBrute.dateActualisation,
          nbActualisations: schema.offreBrute.nbActualisations,
        })
        .from(schema.offreBrute)
        .where(eq(schema.offreBrute.id, o.id))
    )[0];
    if (existante) {
      // Une offre revue est rafraîchie : payload et champs dérivés compris, sinon
      // une offre importée avant l'ajout d'un champ resterait aveugle pour toujours.
      const reactualisee =
        !!o.dateActualisation && !!existante.dateActualisation && o.dateActualisation > existante.dateActualisation;
      await db
        .update(schema.offreBrute)
        .set({
          lastSeenAt: nowIso,
          closedAt: null,
          payload: o.payload,
          codeInsee: o.codeInsee ?? null,
          lat: o.lat ?? null,
          lon: o.lon ?? null,
          nombrePostes: o.nombrePostes ?? null,
          manqueCandidats: o.manqueCandidats ?? 0,
          trancheEffectifEtab: o.trancheEffectifEtab ?? null,
          dateActualisation: o.dateActualisation ?? existante.dateActualisation,
          nbActualisations: (existante.nbActualisations ?? 0) + (reactualisee ? 1 : 0),
          typeContrat: o.typeContrat,
          dureeContratJours: o.dureeContratJours,
          rome: o.rome,
          intitule: o.intitule,
        })
        .where(eq(schema.offreBrute.id, o.id));
      return false;
    }
    await db.insert(schema.offreBrute).values({
      id: o.id,
      siret: o.siret,
      entrepriseNom: o.entrepriseNom,
      intitule: o.intitule,
      typeContrat: o.typeContrat,
      dureeContratJours: o.dureeContratJours,
      rome: o.rome,
      codePostal: o.codePostal,
      commune: o.commune,
      codeInsee: o.codeInsee ?? null,
      lat: o.lat ?? null,
      lon: o.lon ?? null,
      parAgenceInterim: o.parAgenceInterim,
      datePublication: o.datePublication,
      dateActualisation: o.dateActualisation ?? null,
      // Une offre déjà actualisée à sa première lecture compte une actualisation.
      nbActualisations:
        o.dateActualisation && o.dateActualisation.slice(0, 10) > o.datePublication.slice(0, 10) ? 1 : 0,
      nombrePostes: o.nombrePostes ?? null,
      manqueCandidats: o.manqueCandidats ?? 0,
      trancheEffectifEtab: o.trancheEffectifEtab ?? null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      closedAt: null,
      source: o.source,
      payload: o.payload,
    });
    return true;
  }

  if (record.kind === "attribut") {
    const existant = (
      await db
        .select({ siret: schema.etablissement.siret, trancheEffectif: schema.etablissement.trancheEffectif })
        .from(schema.etablissement)
        .where(eq(schema.etablissement.siret, record.siret))
    )[0];
    if (!existant) return false;
    const a = record.attributs;
    const set: Partial<typeof schema.etablissement.$inferInsert> = {};
    if (a.icpe !== undefined) set.icpe = a.icpe;
    if (a.icpeRegime !== undefined) set.icpeRegime = a.icpeRegime;
    if (a.lbbScore !== undefined) set.lbbScore = a.lbbScore;
    if (a.lbbMaj !== undefined) set.lbbMaj = a.lbbMaj;
    // Une tranche apportée par une autre source ne remplace jamais une tranche INSEE connue.
    if (a.trancheEffectif !== undefined && !estTrancheConnue(existant.trancheEffectif) && estTrancheConnue(a.trancheEffectif)) {
      set.trancheEffectif = a.trancheEffectif;
      set.trancheEffectifSource = a.trancheEffectifSource ?? null;
      const { effectifEstime } = await import("../reference/tranches");
      set.effectifEstime = effectifEstime(a.trancheEffectif);
    }
    if (Object.keys(set).length === 0) return false;
    await db.update(schema.etablissement).set(set).where(eq(schema.etablissement.siret, record.siret));
    return true;
  }

  return false;
}
