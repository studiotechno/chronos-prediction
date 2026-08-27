/**
 * Explicabilité : raison d'appeler générée par templates DÉTERMINISTES
 * à partir des 2-3 signaux dominants. Pas de LLM dans le chemin critique.
 */
import { trancheByCode } from "../reference/tranches";
import type { SignalContribution, SignalScoringInput } from "./types";

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function dateFr(iso: string): string {
  const d = new Date(iso);
  const jour = d.getDate();
  return `${jour === 1 ? "1er" : jour} ${MOIS_FR[d.getMonth()]}`;
}

export function montantFr(montant: number): string {
  if (montant >= 1_000_000) {
    const m = montant / 1_000_000;
    return `${m.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  }
  return `${Math.round(montant / 1000)} k€`;
}

/** « Cariste CACES 3 (H/F) » → « cariste CACES 3 » */
export function metier(intitule: string): string {
  const nettoye = intitule.replace(/\s*\((H\/F|F\/H)\)\s*/gi, "").trim();
  return nettoye.charAt(0).toLowerCase() + nettoye.slice(1);
}

type SignalAvecPayload = SignalScoringInput & { contribution: number };

function str(payload: Record<string, unknown> | null, key: string): string {
  const v = payload?.[key];
  return typeof v === "string" ? v : "";
}

function num(payload: Record<string, unknown> | null, key: string): number {
  const v = payload?.[key];
  return typeof v === "number" ? v : 0;
}

/** Clause de phrase (sans majuscule initiale) pour un signal ou un groupe de signaux du même type. */
function clause(type: string, groupe: SignalAvecPayload[]): string | null {
  const s = groupe[0];
  const p = s.payload;
  switch (type) {
    case "OFFRE_REPUBLIEE":
      return `a republié ${num(p, "nbRepublications")} fois la même offre de ${metier(str(p, "intitule"))} depuis le ${dateFr(str(p, "premierePublication") || s.occurredAt)}`;
    case "MARCHE_ATTRIBUE":
      return `a décroché un marché public de ${montantFr(num(p, "montant"))} le ${dateFr(s.occurredAt)}`;
    case "OFFRE_DIRECTE": {
      if (groupe.length > 1) {
        const plusAncien = groupe.reduce((a, b) => (a.occurredAt < b.occurredAt ? a : b));
        return `a publié ${groupe.length} offres en direct depuis le ${dateFr(plusAncien.occurredAt)}`;
      }
      return `a publié une offre de ${metier(str(p, "intitule"))} en direct le ${dateFr(s.occurredAt)}`;
    }
    case "OFFRE_VELOCITE":
      return `a publié ${num(p, "nbOffres14j")} offres en 14 jours, très au-dessus de son rythme habituel`;
    case "CDD_COURT_REPETE":
      return `enchaîne ${num(p, "nbCdd")} CDD courts sur ${num(p, "fenetreJours") || 60} jours`;
    case "EFFECTIF_UP": {
      const avant = trancheByCode(str(p, "trancheAvant"))?.labelFr ?? "?";
      const apres = trancheByCode(str(p, "trancheApres"))?.labelFr ?? "?";
      return `est passé de ${avant} à ${apres}`;
    }
    case "BODACC_CAPITAL":
      return str(p, "typeAnnonce") === "fusion"
        ? `a annoncé une fusion au BODACC le ${dateFr(s.occurredAt)}`
        : `a réalisé une augmentation de capital le ${dateFr(s.occurredAt)}`;
    default:
      return null;
  }
}

/** Résumé court d'un signal (badges, timeline). */
export function resumeSignal(s: SignalScoringInput): string {
  const p = s.payload;
  switch (s.type) {
    case "OFFRE_REPUBLIEE":
      return `Republiée ×${num(p, "nbRepublications")} : ${metier(str(p, "intitule"))}`;
    case "MARCHE_ATTRIBUE":
      return `Marché ${montantFr(num(p, "montant"))} — ${str(p, "acheteur")}`;
    case "OFFRE_DIRECTE":
      return `Offre ${str(p, "typeContrat") || "?"} : ${metier(str(p, "intitule"))}`;
    case "OFFRE_VELOCITE":
      return `${num(p, "nbOffres14j")} offres en 14 jours (baseline ${num(p, "baselineMoyenne").toLocaleString("fr-FR")})`;
    case "CDD_COURT_REPETE":
      return `${num(p, "nbCdd")} CDD < 3 mois sur ${num(p, "fenetreJours") || 60} jours`;
    case "EFFECTIF_UP": {
      const avant = trancheByCode(str(p, "trancheAvant"))?.labelFr ?? "?";
      const apres = trancheByCode(str(p, "trancheApres"))?.labelFr ?? "?";
      return `Effectif : ${avant} → ${apres}`;
    }
    case "BODACC_CAPITAL":
      return str(p, "typeAnnonce") === "fusion" ? "Fusion annoncée au BODACC" : `Augmentation de capital`;
    case "BODACC_RISQUE":
      return capitalize(str(p, "procedure") || "procédure collective");
    case "MISSION_CONCURRENT":
      return `${str(p, "agenceInterim")} : ${metier(str(p, "intitule"))} à ${str(p, "commune")}`;
    default:
      return s.type;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type RaisonResult = {
  raisonFr: string;
  topSignals: { id: string; type: string; occurredAt: string; contribution: number; resumeFr: string }[];
};

/**
 * Assemble la raison d'appeler à partir des signaux dominants.
 * Exemple : « A republié 3 fois la même offre de cariste CACES 3 depuis le 12 août,
 * et a décroché un marché public de 480 k€ le 3 août. Secteur à fort recours à l'intérim. »
 */
export function buildRaison(
  signaux: SignalScoringInput[],
  contributions: SignalContribution[],
  opts: { tauxRecoursSecteur: number; seuilSecteurFort?: number },
): RaisonResult {
  const parId = new Map(signaux.map((s) => [s.id, s]));
  const tries = [...contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  const topSignals = tries.slice(0, 5).map((c) => {
    const s = parId.get(c.id)!;
    return {
      id: c.id,
      type: c.type,
      occurredAt: c.occurredAt,
      contribution: c.contribution,
      resumeFr: resumeSignal(s),
    };
  });

  // Groupes de signaux positifs par type, ordonnés par contribution cumulée
  const positifs = tries.filter((c) => c.contribution > 0);
  const groupes = new Map<string, SignalAvecPayload[]>();
  for (const c of positifs) {
    const s = parId.get(c.id);
    if (!s) continue;
    const g = groupes.get(c.type) ?? [];
    g.push({ ...s, contribution: c.contribution });
    groupes.set(c.type, g);
  }
  const groupesTries = [...groupes.entries()].sort(
    (a, b) =>
      b[1].reduce((s, x) => s + x.contribution, 0) - a[1].reduce((s, x) => s + x.contribution, 0),
  );

  const clauses: string[] = [];
  for (const [type, groupe] of groupesTries) {
    if (clauses.length >= 3) break;
    const c = clause(type, groupe);
    if (c) clauses.push(c);
  }

  let raison: string;
  if (clauses.length === 0) {
    raison = "Bon profil structurel, aucun déclencheur récent.";
  } else if (clauses.length === 1) {
    raison = `${capitalize(clauses[0])}.`;
  } else {
    const debut = clauses.slice(0, -1).join(", ");
    raison = `${capitalize(debut)}, et ${clauses[clauses.length - 1]}.`;
  }

  if (opts.tauxRecoursSecteur >= (opts.seuilSecteurFort ?? 5) && clauses.length > 0) {
    raison += " Secteur à fort recours à l'intérim.";
  }

  const risque = tries.find((c) => c.type === "BODACC_RISQUE");
  if (risque) {
    const s = parId.get(risque.id);
    const procedure = str(s?.payload ?? null, "procedure") || "procédure collective";
    raison += ` Attention : ${procedure} en cours depuis le ${dateFr(risque.occurredAt)}.`;
  }

  return { raisonFr: raison, topSignals };
}
