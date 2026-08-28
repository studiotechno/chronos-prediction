/**
 * Sismo — score événementiel 0..100. Les déclencheurs datés, avec leur horloge propre.
 *
 * contribution = poids_type × confidence × facteurs × K_type(âge)
 *   · noyau IMMÉDIAT : K = exp(-ln2 × âge / demi-vie) — le besoin est maintenant ;
 *   · noyau À RETARD : K = max(plancher (décroissant après le pic), log-normale
 *     centrée sur `pic` jours) — un marché attribué ou un permis pèse au moment
 *     où le chantier démarre, pas à la signature.
 *
 * Puis : saturation PAR FAMILLE de source (cinq offres d'un même hôpital ne valent
 * pas une offre et un marché), bonus de CORROBORATION quand plusieurs familles
 * convergent, et normalisation logistique recalée (0 contribution → 0).
 */
import { signalTypeLabel } from "./labels";
import { familleDeType, TYPES_SECTORISES } from "./weights-defaults";
import { trigramSimilarity } from "../matching/trigram";
import type {
  ScoreComponent,
  SignalContribution,
  SignalScoringInput,
  SismoResult,
  WeightMap,
} from "./types";

const LN2 = Math.log(2);
const JOUR_MS = 86400000;

/** CPV à fort recours à l'intérim : BTP (45), transport (60), logistique (63), espaces verts (77), propreté (90). */
const CPV_CIBLES = ["45", "60", "63", "77", "90"];

export type SismoContext = {
  weights: WeightMap;
  romeCibles: string[];
  /** Taux de recours à l'intérim du secteur de l'établissement (%) : multiplie les signaux d'offres. */
  tauxSecteurPct: number;
  now: Date;
};

export type Noyau = { valeur: number; picAt: string | null; debut: string | null; fin: string | null };

/**
 * Noyau temporel d'un type de signal. Pour un noyau à retard, la fenêtre
 * [debut, fin] est l'intervalle où la log-normale dépasse ~60 % de son pic.
 */
export function noyau(type: string, occurredAt: string, w: WeightMap, now: Date): Noyau {
  const demiVie = w[`sismo.demivie.${type}`];
  const t0 = new Date(occurredAt).getTime();
  const ageJours = Math.max(0, (now.getTime() - t0) / JOUR_MS);
  const pic = w[`sismo.pic.${type}`];

  if (pic === undefined || !(pic > 0)) {
    return { valeur: Math.exp((-LN2 * ageJours) / demiVie), picAt: null, debut: null, fin: null };
  }

  const largeur = Math.max(0.05, w[`sismo.largeur.${type}`] ?? 0.7);
  const plancher = w["sismo.plancher_retard"] ?? 0.4;
  // Plancher : plein dès le jour J jusqu'au pic, puis décroît avec la demi-vie.
  const planch = plancher * Math.exp((-LN2 * Math.max(0, ageJours - pic)) / demiVie);
  // Log-normale normalisée à 1 au pic.
  const x = Math.log((ageJours + 1) / pic);
  const cloche = Math.exp(-(x * x) / (2 * largeur * largeur));
  const debut = new Date(t0 + pic * Math.exp(-largeur) * JOUR_MS).toISOString();
  const fin = new Date(t0 + pic * Math.exp(largeur) * JOUR_MS).toISOString();
  return {
    valeur: Math.max(planch, cloche),
    picAt: new Date(t0 + pic * JOUR_MS).toISOString(),
    debut,
    fin,
  };
}

/** Objet de marché ramené à sa forme comparable (casse, accents, ponctuation). */
function objetNormalise(s: SignalScoringInput): string {
  const brut = typeof s.payload?.objet === "string" ? (s.payload.objet as string) : "";
  return brut
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Le BOAMP publie l'attribution le jour même ; le DECP republie le même marché des
 * semaines plus tard, avec son montant. Sans dédoublonnage, un marché unique
 * compterait deux fois. On regroupe les MARCHE_ATTRIBUE du même établissement dont
 * les dates sont proches ET les objets semblables, on garde la contribution la plus
 * forte, et on annule les autres — elles restent dans la chronologie (contribution
 * nulle), parce que les deux avis existent bel et bien.
 */
export function dedupliquerMarches(
  contributions: SignalContribution[],
  signals: SignalScoringInput[],
  w: WeightMap,
): void {
  const fenetreJours = w["sismo.marche.dedup_jours"] ?? 0;
  if (!(fenetreJours > 0)) return;
  const seuil = w["sismo.marche.dedup_similarite"] ?? 0.55;
  const parId = new Map(signals.map((s) => [s.id, s]));

  const marches = contributions
    .filter((c) => c.type === "MARCHE_ATTRIBUE" && c.contribution > 0)
    .map((c) => ({
      c,
      t: new Date(c.occurredAt).getTime(),
      objet: objetNormalise(parId.get(c.id) ?? { payload: null } as SignalScoringInput),
    }))
    // Du plus contributif au moins : le premier de chaque groupe est celui qu'on garde.
    .sort((a, b) => b.c.contribution - a.c.contribution);

  const absorbes = new Set<string>();
  for (let i = 0; i < marches.length; i++) {
    if (absorbes.has(marches[i].c.id)) continue;
    for (let j = i + 1; j < marches.length; j++) {
      if (absorbes.has(marches[j].c.id)) continue;
      const ecartJours = Math.abs(marches[i].t - marches[j].t) / JOUR_MS;
      if (ecartJours > fenetreJours) continue;
      // Deux objets vides ne prouvent rien : sans libellé, on ne fusionne pas.
      if (!marches[i].objet || !marches[j].objet) continue;
      if (trigramSimilarity(marches[i].objet, marches[j].objet) < seuil) continue;
      absorbes.add(marches[j].c.id);
    }
  }
  for (const c of contributions) if (absorbes.has(c.id)) c.contribution = 0;
}

function romesDe(s: SignalScoringInput): string[] {
  if (s.romes && s.romes.length > 0) return s.romes;
  const rome = typeof s.payload?.rome === "string" ? (s.payload.rome as string) : null;
  return rome ? [rome] : [];
}

export function computeSismo(signals: SignalScoringInput[], ctx: SismoContext): SismoResult {
  const w = ctx.weights;
  const contributions: SignalContribution[] = [];
  const fenetres: { contribution: number; debut: string; fin: string }[] = [];
  const facteurSecteur = Math.max(
    w["sismo.secteur.plancher"] ?? 0,
    Math.min(1, ctx.tauxSecteurPct / (w["strate.naf.taux_ref"] || 8)),
  );

  for (const s of signals) {
    const poids = w[`sismo.poids.${s.type}`];
    const demiVie = w[`sismo.demivie.${s.type}`];
    if (poids === undefined || demiVie === undefined || poids === 0) continue;

    const k = noyau(s.type, s.occurredAt, w, ctx.now);
    let facteur = 1;
    const romes = romesDe(s);

    // Offres : un métier hors des ROME cibles de l'agence pèse beaucoup moins,
    // et un secteur à faible recours à l'intérim aussi (le supermarché à 12 offres).
    if (s.type.startsWith("OFFRE") || s.type === "CDD_COURT_REPETE") {
      if (romes.length > 0 && !romes.some((r) => ctx.romeCibles.includes(r))) {
        facteur *= w["sismo.rome_hors_cible"];
      }
    }
    if (TYPES_SECTORISES.has(s.type)) facteur *= facteurSecteur;

    if (s.type === "OFFRE_MULTIPOSTES") {
      const postes = typeof s.payload?.nombrePostes === "number" ? (s.payload.nombrePostes as number) : 2;
      facteur *= Math.max(0.2, Math.min(1, postes / (w["sismo.postes.ref"] || 5)));
    }
    if (s.type === "OFFRE_REACTUALISEE") {
      const nb = typeof s.payload?.nbActualisations === "number" ? (s.payload.nbActualisations as number) : 2;
      facteur *= Math.max(0.3, Math.min(1, nb / (w["sismo.actualisations.ref"] || 3)));
    }

    // Marchés publics : pondérés par le montant (inconnu → 0.6) et par le CPV / les métiers induits
    if (s.type === "MARCHE_ATTRIBUE") {
      const montant = typeof s.payload?.montant === "number" ? (s.payload.montant as number) : null;
      facteur *= montant != null ? Math.max(0.2, Math.min(1, montant / w["sismo.marche.montant_ref"])) : 0.6;
      const cpv = typeof s.payload?.cpv === "string" ? (s.payload.cpv as string) : "";
      const cible = cpv ? CPV_CIBLES.some((p) => cpv.startsWith(p)) : romes.length > 0;
      if (!cible) facteur *= w["sismo.marche.cpv_hors_cible"];
    }

    const contribution = round2(poids * s.confidence * facteur * k.valeur);
    contributions.push({
      id: s.id,
      type: s.type,
      occurredAt: s.occurredAt,
      contribution,
      picAt: k.picAt ?? undefined,
    });
    if (k.debut && k.fin && contribution > 0 && new Date(k.fin).getTime() > ctx.now.getTime()) {
      fenetres.push({ contribution, debut: k.debut, fin: k.fin });
    }
  }

  // Un marché republié par une seconde source ne compte qu'une fois
  dedupliquerMarches(contributions, signals, w);

  // Saturation par famille, puis corroboration
  const cap = Math.max(1, w["sismo.famille.cap"] ?? 40);
  const parFamille = new Map<string, { positif: number; negatif: number }>();
  for (const c of contributions) {
    const f = familleDeType(c.type);
    const acc = parFamille.get(f) ?? { positif: 0, negatif: 0 };
    if (c.contribution > 0) acc.positif += c.contribution;
    else acc.negatif += c.contribution;
    parFamille.set(f, acc);
  }
  let positifs = 0;
  let negatifs = 0;
  let famillesPositives = 0;
  for (const acc of parFamille.values()) {
    if (acc.positif > 0) {
      positifs += cap * (1 - Math.exp(-acc.positif / cap));
      famillesPositives++;
    }
    negatifs += acc.negatif;
  }
  const bonus = w["sismo.corroboration.bonus"] ?? 0;
  const sommeBrute = positifs * (1 + bonus * Math.max(0, famillesPositives - 1)) + negatifs;
  const score = normalisationLogistique(sommeBrute, w);

  // Agrégation par type pour les barres de décomposition
  const parType = new Map<string, number>();
  for (const c of contributions) {
    parType.set(c.type, (parType.get(c.type) ?? 0) + c.contribution);
  }
  const components: ScoreComponent[] = [...parType.entries()]
    .map(([type, contribution]) => ({
      key: type,
      labelFr: signalTypeLabel(type),
      contribution: round2(contribution),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  if (famillesPositives > 1 && bonus > 0) {
    components.push({
      key: "corroboration",
      labelFr: "Corroboration",
      contribution: round2(positifs * bonus * (famillesPositives - 1)),
      detailFr: `${famillesPositives} familles de sources convergent`,
    });
  }

  // Fenêtre d'appel : celle du signal à retard le plus contributif encore à venir
  const fenetre = fenetres.sort((a, b) => b.contribution - a.contribution)[0] ?? null;

  // Métiers induits, du signal le plus contributif au moins
  const romesInduits: string[] = [];
  const parId = new Map(signals.map((s) => [s.id, s]));
  for (const c of [...contributions].sort((a, b) => b.contribution - a.contribution)) {
    if (c.contribution <= 0) continue;
    const s = parId.get(c.id);
    if (!s) continue;
    for (const r of romesDe(s)) if (!romesInduits.includes(r)) romesInduits.push(r);
  }

  return {
    score,
    sommeBrute: round2(sommeBrute),
    components,
    contributions,
    fenetre: fenetre ? { debut: fenetre.debut, fin: fenetre.fin } : null,
    romesInduits,
  };
}

/**
 * Logistique recalée : L(x) = 1 / (1 + exp(-(x - midpoint) / pente)),
 * renormalisée pour que somme 0 → score 0 et somme +∞ → 100.
 * Une somme négative (malus BODACC) donne 0.
 */
export function normalisationLogistique(somme: number, w: WeightMap): number {
  const mid = w["sismo.norm.midpoint"];
  const pente = w["sismo.norm.pente"];
  const L = (x: number) => 1 / (1 + Math.exp(-(x - mid) / pente));
  const zero = L(0);
  const score = (100 * (L(somme) - zero)) / (1 - zero);
  return round2(Math.max(0, Math.min(100, score)));
}

/** Voir strate.ts : un score n'est jamais NaN, même sur une entrée non finie. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
