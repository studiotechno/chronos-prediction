/**
 * Pont base ↔ moteur : charge les entrées depuis PostgreSQL, exécute le moteur
 * pur, et (optionnellement) persiste scores, leads et le snapshot du jour.
 * Utilisé par `npm run score` et par l'API de recalcul en direct de /reglages.
 */
import { eq, gte, notInArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { chunk } from "../db/chunk";
import { tauxRecoursInterim } from "../reference/dares";
import { tauxRecoursIdcc } from "../reference/idcc";
import { facteurSaison } from "../reference/saison";
import { lectureBmo } from "../reference/bmo";
import { defaultWeightMap, WEIGHT_DEFAULTS } from "./weights-defaults";
import { computeAll, type EngineInput, type EngineOutput, type OffreBassin } from "./engine";
import type { LectureSecteur } from "./strate";
import type { SignalScoringInput, WeightMap } from "./types";

type Db = PostgresJsDatabase<typeof schema>;

/** Exclusions par défaut : les agences d'intérim elles-mêmes et l'administration publique. */
export const NAF_EXCLUS_DEFAUT = ["78", "84"];

export async function loadWeights(db: Db): Promise<WeightMap> {
  const rows = await db.select().from(schema.weights);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Aligne la table `weights` sur le registre du code : un poids introduit après le
 * dernier seed apparaît dans /reglages, un poids retiré du code n'y traîne plus.
 * Les valeurs réglées à la main ne sont jamais touchées.
 */
export async function synchroniserWeights(db: Db): Promise<{ ajoutes: number; retires: number }> {
  const now = new Date().toISOString();
  const cles = WEIGHT_DEFAULTS.map((w) => w.key);
  let ajoutes = 0;
  for (const paquet of chunk(WEIGHT_DEFAULTS.map((w) => ({ ...w, updatedAt: now })))) {
    const ecrits = await db
      .insert(schema.weights)
      .values(paquet)
      .onConflictDoNothing()
      .returning({ key: schema.weights.key });
    ajoutes += ecrits.length;
  }
  const retires = (
    await db.delete(schema.weights).where(notInArray(schema.weights.key, cles)).returning({ key: schema.weights.key })
  ).length;
  return { ajoutes, retires };
}

/** Taux de recours du secteur : la convention collective d'abord, la division NAF sinon. */
export function lireSecteur(naf: string, idcc: string[]): LectureSecteur {
  const parIdcc = tauxRecoursIdcc(idcc);
  if (parIdcc) {
    if (parIdcc.niveauSource === "exclu") {
      return { tauxPct: 0, detailFr: `Convention ${parIdcc.idcc} — ${parIdcc.libelle} : hors cible`, exclu: true };
    }
    return {
      tauxPct: parIdcc.tauxPct,
      detailFr: `Recours à l'intérim ${parIdcc.tauxPct.toLocaleString("fr-FR")} % — convention ${parIdcc.idcc}, ${parIdcc.libelle}`,
    };
  }
  const taux = tauxRecoursInterim(naf);
  return {
    tauxPct: taux,
    detailFr: `Recours à l'intérim ${taux.toLocaleString("fr-FR")} % — division NAF ${naf.slice(0, 2)}`,
    exclu: naf.replace(/[^0-9]/g, "").startsWith("78"),
  };
}

export async function loadEngineInput(
  db: Db,
  weightsOverride?: Partial<WeightMap>,
): Promise<EngineInput> {
  // Les défauts du code couvrent un poids introduit après le dernier seed
  const weights: WeightMap = { ...defaultWeightMap(), ...(await loadWeights(db)) };
  if (weightsOverride) {
    for (const [k, v] of Object.entries(weightsOverride)) {
      if (typeof v === "number" && Number.isFinite(v)) weights[k] = v;
    }
  }

  const now = new Date();
  const JOUR_MS = 86400000;
  const [agenceRows, etabs, entreprises, signauxRows, offresRows] = await Promise.all([
    db.select().from(schema.agence).limit(1),
    db.select().from(schema.etablissement),
    db.select().from(schema.entreprise),
    // Tous les signaux, y compris ceux de bassin (MISSION_CONCURRENT, AO_OUVERT) :
    // ils n'ont ni SIRET ni SIREN et ne scorent personne, mais ils décrivent le
    // marché local et nourrissent Tempo.
    db.select().from(schema.signal),
    // Le dénominateur de l'intérimabilité : TOUTES les offres directes du bassin
    // des 90 derniers jours — nommées ou anonymes, rattachées ou non. Lues dans le
    // staging plutôt que dans les signaux : une offre nommée mais non rattachée
    // n'a pas de signal, et elle dit pourtant que ce métier se recrute ici.
    db
      .select({ rome: schema.offreBrute.rome, parAgenceInterim: schema.offreBrute.parAgenceInterim })
      .from(schema.offreBrute)
      .where(gte(schema.offreBrute.datePublication, new Date(now.getTime() - 90 * JOUR_MS).toISOString())),
  ]);

  const agenceRow = agenceRows[0];
  if (!agenceRow) {
    throw new Error(
      "Aucune agence configurée — inscrivez-la dans l'application (/inscription), " +
        "ou posez l'agence de démo avec `npm run db:seed`.",
    );
  }

  const entrepriseParSiren = new Map(entreprises.map((e) => [e.siren, e]));
  const parSiren = new Map<string, number>();
  const siegeParSiren = new Map<string, string>();
  for (const e of etabs) {
    if (e.etatAdministratif === "A") parSiren.set(e.siren, (parSiren.get(e.siren) ?? 0) + 1);
    if (e.estSiege === 1 || !siegeParSiren.has(e.siren)) siegeParSiren.set(e.siren, e.siret);
  }

  const signauxParSiret = new Map<string, SignalScoringInput[]>();
  const missionsBassin: { rome: string | null; occurredAt: string }[] = [];
  const offresDirectesBassin: OffreBassin[] = offresRows
    .filter((o) => o.parAgenceInterim !== 1)
    .map((o) => ({ rome: o.rome }));
  const aoOuverts: { romes: string[]; dateLimite: string | null }[] = [];
  for (const s of signauxRows) {
    const romePayload = typeof s.payload?.rome === "string" ? (s.payload.rome as string) : null;
    if (s.type === "MISSION_CONCURRENT") {
      missionsBassin.push({ rome: romePayload, occurredAt: s.occurredAt });
      continue;
    }
    if (s.type === "DEMANDE_ANONYME") continue;
    if (s.type === "AO_OUVERT") {
      aoOuverts.push({
        romes: s.romes ?? [],
        dateLimite: typeof s.payload?.dateLimite === "string" ? (s.payload.dateLimite as string) : null,
      });
      continue;
    }
    // Un signal au SIREN seul (BODACC, accords) se rattache au siège s'il est
    // désormais dans le référentiel — sans attendre une ré-ingestion.
    const siret = s.siret ?? (s.siren ? siegeParSiren.get(s.siren) ?? null : null);
    if (!siret) continue;
    const liste = signauxParSiret.get(siret) ?? [];
    liste.push({
      id: s.id,
      type: s.type,
      occurredAt: s.occurredAt,
      confidence: s.confidence,
      payload: s.payload ?? null,
      lieu: s.lieu ?? null,
      romes: s.romes ?? null,
    });
    signauxParSiret.set(siret, liste);
  }

  return {
    etablissements: etabs.map((e) => {
      const ent = entrepriseParSiren.get(e.siren);
      return {
        siret: e.siret,
        siren: e.siren,
        denomination: e.denomination,
        naf: e.naf,
        idcc: e.idcc && e.idcc.length > 0 ? e.idcc : (ent?.idcc ?? []),
        trancheEffectif: e.trancheEffectif,
        trancheEffectifSource: e.trancheEffectifSource,
        effectifEstime: e.effectifEstime,
        caractereEmployeur: e.caractereEmployeur ?? ent?.caractereEmployeur ?? null,
        lat: e.lat,
        lon: e.lon,
        codeInsee: e.codeInsee,
        commune: e.commune,
        dateCreation: e.dateCreation,
        etatAdministratif: e.etatAdministratif,
        nbEtabsBassin: parSiren.get(e.siren) ?? 1,
        ca: ent?.ca ?? null,
        caPrecedent: ent?.caPrecedent ?? null,
        resultatNet: ent?.resultatNet ?? null,
        icpe: e.icpe === 1,
        lbbScore: e.lbbScore ?? null,
      };
    }),
    signauxParSiret,
    missionsBassin,
    offresDirectesBassin,
    aoOuverts,
    agence: {
      lat: agenceRow.lat,
      lon: agenceRow.lon,
      rayonKm: agenceRow.rayonKm,
      romeCibles: agenceRow.romeCibles ?? [],
      nafCibles: agenceRow.nafCibles ?? [],
      nafExclus: agenceRow.nafExclus ?? NAF_EXCLUS_DEFAUT,
      departement: agenceRow.departement ?? agenceRow.codePostal?.slice(0, 2) ?? null,
    },
    weights,
    tauxRecours: lireSecteur,
    facteurSaison,
    bmo: (dept, romes) => lectureBmo(dept, romes),
    now,
  };
}

export async function runScoring(
  db: Db,
  opts: { persist: boolean; weightsOverride?: Partial<WeightMap> } = { persist: true },
): Promise<EngineOutput> {
  if (opts.persist) await synchroniserWeights(db);
  const input = await loadEngineInput(db, opts.weightsOverride);
  const output = computeAll(input);

  if (opts.persist) {
    const computedAt = input.now.toISOString();
    const jour = computedAt.slice(0, 10);
    // Statuts commerciaux existants à préserver au recalcul
    const statuts = new Map((await db.select().from(schema.lead)).map((l) => [l.siret, l.statut]));

    // Dernière barrière avant la base : un score non fini ne doit jamais être
    // persisté. Il survivrait aux redémarrages, contaminerait tous les écrans qui
    // le lisent, et ne serait rattrapé que par un recalcul. Le compter et le dire
    // vaut mieux que l'écrire en silence — c'est le symptôme d'un champ de source
    // que le parsing laisse passer.
    const nonFinis: string[] = [];
    const assainir = (siret: string, score: number): number => {
      if (Number.isFinite(score)) return score;
      nonFinis.push(siret);
      return 0;
    };

    const strates = [...output.strates].map(([siret, r]) => ({
      siret,
      score: assainir(siret, r.score),
      components: r.components,
      computedAt,
    }));
    const sismos = [...output.sismos].map(([siret, r]) => ({
      siret,
      score: assainir(siret, r.score),
      components: r.components,
      computedAt,
    }));
    const tempos = [...output.tempos].map(([siret, r]) => ({
      siret,
      score: assainir(siret, r.score),
      components: r.components,
      computedAt,
    }));
    const leads = output.leads.map((lead) => ({
      siret: lead.siret,
      scoreFinal: assainir(lead.siret, lead.scoreFinal),
      strate: assainir(lead.siret, lead.strate),
      sismo: assainir(lead.siret, lead.sismo),
      tempo: assainir(lead.siret, lead.tempo),
      statut: statuts.get(lead.siret) ?? "nouveau",
      segment: lead.segment,
      raisonFr: lead.raisonFr,
      propositionFr: lead.propositionFr,
      topSignals: lead.topSignals,
      fenetreDebut: lead.fenetre?.debut ?? null,
      fenetreFin: lead.fenetre?.fin ?? null,
      lieuBesoinFr: lead.lieuBesoinFr,
      distanceBesoinKm: lead.distanceBesoinKm,
      romesInduits: lead.romesInduits,
      computedAt,
    }));
    const snapshots = leads.map((l) => ({
      jour,
      siret: l.siret,
      strate: l.strate,
      sismo: l.sismo,
      tempo: l.tempo,
      scoreFinal: l.scoreFinal,
      segment: l.segment,
      topTypes: [...new Set(l.topSignals.map((s) => s.type))].slice(0, 5),
    }));

    if (nonFinis.length > 0) {
      const distincts = [...new Set(nonFinis)];
      console.warn(
        `[score] ${distincts.length} établissement(s) au score non fini, ramené à 0 : ` +
          `${distincts.slice(0, 5).join(", ")}${distincts.length > 5 ? "…" : ""}. ` +
          "Cause probable : un champ numérique manquant ou non numérique chez la source.",
      );
    }

    // Insertions par paquets : un aller-retour réseau par ligne rendrait le
    // recalcul inutilisable sur une base distante.
    await db.transaction(async (tx) => {
      await tx.delete(schema.scoreStrate);
      await tx.delete(schema.scoreSismo);
      await tx.delete(schema.scoreTempo);
      await tx.delete(schema.lead);
      for (const paquet of chunk(strates)) await tx.insert(schema.scoreStrate).values(paquet);
      for (const paquet of chunk(sismos)) await tx.insert(schema.scoreSismo).values(paquet);
      for (const paquet of chunk(tempos)) await tx.insert(schema.scoreTempo).values(paquet);
      for (const paquet of chunk(leads)) await tx.insert(schema.lead).values(paquet);
      // Le snapshot DU JOUR est réécrit à chaque recalcul : un jour = un état.
      // Le filtre sur `jour` est ce qui fait exister la mémoire : sans lui, chaque
      // recalcul effaçait tout l'historique des établissements rescorés — constaté
      // le 10/09/2026, un seul jour de snapshots après quinze jours d'ingestion.
      // Tout le jour, pas seulement les SIRET rescorés : un établissement qui n'est
      // plus un lead ce soir ne doit pas rester dans l'état du jour.
      await tx.delete(schema.scoreSnapshot).where(eq(schema.scoreSnapshot.jour, jour));
      for (const paquet of chunk(snapshots)) {
        await tx.insert(schema.scoreSnapshot).values(paquet).onConflictDoNothing();
      }
    });
  }

  return output;
}
