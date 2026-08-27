/**
 * Orchestration du scoring — TS pur, aucune dépendance base ni réseau.
 * Reçoit établissements + signaux + poids + agence, rend Strate, Sismo et leads.
 */
import { computeStrate } from "./strate";
import { computeSismo } from "./sismo";
import { computeFinal } from "./final";
import { buildRaison } from "./raison";
import type {
  AgenceScoringInput,
  EtabScoringInput,
  LeadResult,
  SignalScoringInput,
  SismoResult,
  StrateResult,
  WeightMap,
} from "./types";

export type EngineInput = {
  etablissements: EtabScoringInput[];
  /** Signaux rattachés, par SIRET (les signaux à siret NULL ne scorent personne). */
  signauxParSiret: Map<string, SignalScoringInput[]>;
  agence: AgenceScoringInput;
  weights: WeightMap;
  tauxRecours: (naf: string) => number;
  now: Date;
};

export type EngineOutput = {
  strates: Map<string, StrateResult>;
  sismos: Map<string, SismoResult>;
  leads: LeadResult[];
};

export function computeAll(input: EngineInput): EngineOutput {
  const strates = new Map<string, StrateResult>();
  const sismos = new Map<string, SismoResult>();
  const leads: LeadResult[] = [];

  for (const etab of input.etablissements) {
    if (etab.etatAdministratif === "F") continue;
    const signaux = input.signauxParSiret.get(etab.siret) ?? [];

    const aProcedureCollective = signaux.some((s) => s.type === "BODACC_RISQUE");
    const aDepotComptes = signaux.some(
      (s) => s.type === "BODACC_CAPITAL" && s.payload?.typeAnnonce === "depot_comptes",
    );

    const strate = computeStrate(etab, {
      agence: input.agence,
      weights: input.weights,
      tauxRecours: input.tauxRecours,
      aProcedureCollective,
      aDepotComptes,
      now: input.now,
    });
    const sismo = computeSismo(signaux, {
      weights: input.weights,
      romeCibles: input.agence.romeCibles,
      now: input.now,
    });
    strates.set(etab.siret, strate);
    sismos.set(etab.siret, sismo);

    // Un lead n'existe que s'il y a au moins un signal scorable :
    // un établissement sans aucun déclencheur n'est ni chaud ni nurturing, il est hors radar.
    if (sismo.contributions.length === 0) continue;

    const { scoreFinal, segment } = computeFinal(strate.score, sismo.score, input.weights);
    const { raisonFr, topSignals } = buildRaison(signaux, sismo.contributions, {
      tauxRecoursSecteur: input.tauxRecours(etab.naf),
    });

    leads.push({
      siret: etab.siret,
      scoreFinal,
      strate: strate.score,
      sismo: sismo.score,
      segment,
      raisonFr,
      topSignals,
    });
  }

  leads.sort((a, b) => b.scoreFinal - a.scoreFinal);
  return { strates, sismos, leads };
}
