/**
 * Orchestration du scoring — TS pur, aucune dépendance base ni réseau.
 * Reçoit établissements + signaux + poids + agence + lectures de référence,
 * rend Strate, Sismo, Tempo et leads.
 */
import { computeStrate, type LectureSecteur } from "./strate";
import { computeSismo } from "./sismo";
import { computeTempo, type LectureCommandePublique, type LectureConjoncture } from "./tempo";
import { computeFinal } from "./final";
import { buildRaison } from "./raison";
import { distanceKm } from "./geo";
import type {
  AgenceScoringInput,
  EtabScoringInput,
  LeadResult,
  SignalScoringInput,
  SismoResult,
  StrateResult,
  TempoResult,
  WeightMap,
} from "./types";

/** Mission d'intérim publiée par une agence sur le bassin (signal MISSION_CONCURRENT). */
export type MissionBassin = { rome: string | null; occurredAt: string };

/** Appel d'offres public ouvert sur le bassin (signal AO_OUVERT), sans titulaire encore. */
export type AoBassin = { romes: string[]; dateLimite: string | null };

export type EngineInput = {
  etablissements: EtabScoringInput[];
  /** Signaux rattachés, par SIRET (les signaux à siret NULL ne scorent personne). */
  signauxParSiret: Map<string, SignalScoringInput[]>;
  /** Missions concurrentes du bassin, pour la conjoncture de Tempo. */
  missionsBassin: MissionBassin[];
  /** Appels d'offres ouverts du bassin, pour la commande publique de Tempo. */
  aoOuverts: AoBassin[];
  agence: AgenceScoringInput & { departement: string | null };
  weights: WeightMap;
  tauxRecours: (naf: string, idcc: string[]) => LectureSecteur;
  facteurSaison: (naf: string, date: Date) => number;
  bmo: (dept: string | null, romes: string[]) => { partDifficile: number; partSaisonniere: number; projets: number } | null;
  now: Date;
};

export type EngineOutput = {
  strates: Map<string, StrateResult>;
  sismos: Map<string, SismoResult>;
  tempos: Map<string, TempoResult>;
  leads: LeadResult[];
};

const JOUR_MS = 86400000;
/** Au-delà de ce ratio récent / précédent sur tout le bassin, la tendance dit la collecte, pas le marché. */
const BIAIS_MAX = 2.5;
const SEUIL_TENDANCE = 4;

/**
 * Conjoncture locale : pour chaque ROME, missions publiées sur les 45 derniers
 * jours vs les 45 précédents. Muette quand la matière manque ou quand la
 * collecte elle-même est biaisée (les offres closes disparaissent de la source).
 */
export function lireConjoncture(missions: MissionBassin[], now: Date): (romes: string[]) => LectureConjoncture | null {
  const parRome = new Map<string, { recent: number; precedent: number }>();
  let recentTotal = 0;
  let precedentTotal = 0;
  const t = now.getTime();
  for (const m of missions) {
    const age = (t - new Date(m.occurredAt).getTime()) / JOUR_MS;
    if (age < 0 || age > 90) continue;
    const cle = m.rome ?? "?";
    const acc = parRome.get(cle) ?? { recent: 0, precedent: 0 };
    if (age <= 45) {
      acc.recent++;
      recentTotal++;
    } else {
      acc.precedent++;
      precedentTotal++;
    }
    parRome.set(cle, acc);
  }
  const biaise = precedentTotal === 0 || recentTotal / precedentTotal > BIAIS_MAX;

  return (romes: string[]) => {
    if (biaise) return null;
    let recent = 0;
    let precedent = 0;
    const cles = romes.length > 0 ? romes : [...parRome.keys()];
    for (const r of cles) {
      const acc = parRome.get(r);
      if (!acc) continue;
      recent += acc.recent;
      precedent += acc.precedent;
    }
    const nb = recent + precedent;
    if (nb < SEUIL_TENDANCE) return null;
    const delta = (recent - precedent) / Math.max(1, precedent);
    return { delta: Math.max(-1, Math.min(1, delta)), nb };
  };
}

/**
 * Appels d'offres encore ouverts portant sur les métiers demandés : du travail va
 * être commandé sur le bassin, et quelqu'un va le gagner. Lecture positive seulement
 * — l'absence d'appel d'offres ne dit rien.
 */
export function lireCommandePublique(
  aoOuverts: AoBassin[],
  now: Date,
): (romes: string[]) => LectureCommandePublique | null {
  const ouverts = aoOuverts.filter(
    (a) => a.romes.length > 0 && (!a.dateLimite || new Date(a.dateLimite).getTime() >= now.getTime()),
  );
  return (romes: string[]) => {
    if (romes.length === 0) return null;
    const concernes = ouverts.filter((a) => a.romes.some((r) => romes.includes(r)));
    if (concernes.length === 0) return null;
    const echeances = concernes.map((a) => a.dateLimite).filter((d): d is string => !!d).sort();
    return { nb: concernes.length, prochaineEcheance: echeances[0] ?? null };
  };
}

function nafExclu(naf: string, exclus: string[]): boolean {
  const chiffres = naf.replace(/[^0-9]/g, "");
  return exclus.some((e) => {
    const c = e.replace(/[^0-9A-Za-z]/g, "");
    return c.length <= 2 ? chiffres.startsWith(c) : naf.replace(/[^0-9A-Za-z]/g, "").toUpperCase().startsWith(c.toUpperCase());
  });
}

export function computeAll(input: EngineInput): EngineOutput {
  const strates = new Map<string, StrateResult>();
  const sismos = new Map<string, SismoResult>();
  const tempos = new Map<string, TempoResult>();
  const leads: LeadResult[] = [];
  const conjoncture = lireConjoncture(input.missionsBassin, input.now);
  const commandePublique = lireCommandePublique(input.aoOuverts, input.now);
  const exclus = input.agence.nafExclus ?? [];

  for (const etab of input.etablissements) {
    if (etab.etatAdministratif === "F") continue;
    if (nafExclu(etab.naf, exclus)) continue;
    const signaux = input.signauxParSiret.get(etab.siret) ?? [];

    const aProcedureCollective = signaux.some((s) => s.type === "BODACC_RISQUE");
    const aRestructuration = signaux.some(
      (s) =>
        s.type === "ACCORD_RESTRUCTURATION" &&
        (input.now.getTime() - new Date(s.occurredAt).getTime()) / JOUR_MS <= 365,
    );

    // Lieu du besoin : le signal récent (≤ 1 an) porteur d'un lieu le plus proche de l'agence.
    let lieuBesoin: { km: number; libelle: string | null } | null = null;
    for (const s of signaux) {
      if (!s.lieu || !Number.isFinite(s.lieu.lat) || !Number.isFinite(s.lieu.lon)) continue;
      if ((input.now.getTime() - new Date(s.occurredAt).getTime()) / JOUR_MS > 365) continue;
      const km = distanceKm(s.lieu.lat, s.lieu.lon, input.agence.lat, input.agence.lon);
      if (!lieuBesoin || km < lieuBesoin.km) lieuBesoin = { km, libelle: s.lieu.libelle };
    }

    const secteur = input.tauxRecours(etab.naf, etab.idcc ?? []);
    const strate = computeStrate(etab, {
      agence: input.agence,
      weights: input.weights,
      tauxRecours: input.tauxRecours,
      aProcedureCollective,
      aRestructuration,
      lieuBesoin,
      now: input.now,
    });
    const sismo = computeSismo(signaux, {
      weights: input.weights,
      romeCibles: input.agence.romeCibles,
      tauxSecteurPct: secteur.exclu ? 0 : secteur.tauxPct,
      now: input.now,
    });
    const tempo = computeTempo({
      weights: input.weights,
      now: input.now,
      naf: etab.naf,
      romesInduits: sismo.romesInduits,
      fenetre: sismo.fenetre,
      facteurSaison: input.facteurSaison,
      bmo: (romes) => input.bmo(input.agence.departement, romes),
      conjoncture,
      commandePublique,
    });
    strates.set(etab.siret, strate);
    sismos.set(etab.siret, sismo);
    tempos.set(etab.siret, tempo);

    // Un lead n'existe que s'il y a au moins un déclencheur positif : un
    // établissement sans rien, ou seulement en procédure collective, est hors radar.
    if (!sismo.contributions.some((c) => c.contribution > 0)) continue;

    const { scoreFinal, segment: segmentBrut } = computeFinal(
      strate.score,
      sismo.score,
      input.weights,
      tempo.score,
    );

    // Hors de portée : les sources départementales (BODACC, commande publique)
    // ramènent des sièges de toute la France. Un excellent fit à 300 km n'est pas
    // un lead à appeler — il reste visible en nurturing, il ne prend pas la place
    // d'un lead servable dans la liste d'appels.
    const porteeMax = (input.weights["final.rayon_max_facteur"] ?? 3) * input.agence.rayonKm;
    const horsPortee = strate.distanceKm != null && strate.distanceKm > porteeMax;
    const segment = horsPortee ? "nurturing" : segmentBrut;
    const { raisonFr, propositionFr, topSignals } = buildRaison(signaux, sismo.contributions, {
      tauxRecoursSecteur: secteur.tauxPct,
      romesInduits: sismo.romesInduits,
      fenetre: sismo.fenetre,
      lieuFr: strate.lieuFr,
      distanceKm: strate.distanceKm,
      now: input.now,
    });

    leads.push({
      siret: etab.siret,
      scoreFinal,
      strate: strate.score,
      sismo: sismo.score,
      tempo: tempo.score,
      segment,
      raisonFr,
      propositionFr,
      fenetre: sismo.fenetre,
      lieuBesoinFr: strate.lieuFr,
      distanceBesoinKm: strate.distanceKm,
      romesInduits: sismo.romesInduits,
      topSignals,
    });
  }

  leads.sort((a, b) => b.scoreFinal - a.scoreFinal);
  return { strates, sismos, tempos, leads };
}
