/**
 * Tempo — le « quand ». Facteur autour de 1, borné par tempo.min / tempo.max :
 * il ordonne les appels dans la semaine, il ne décide pas de la liste.
 *
 * Quatre lectures, chacune ramenée à [-1, 1] puis multipliée par son amplitude :
 *   · la SAISON du secteur (calendrier embarqué), amplifiée par la part
 *     saisonnière des métiers dans le département (BMO) ;
 *   · la DIFFICULTÉ de recrutement des métiers induits dans le département (BMO) ;
 *   · la CONJONCTURE locale : tendance des missions d'intérim publiées sur le
 *     bassin pour ces métiers (demande prouvée) ;
 *   · la FENÊTRE d'appel dérivée des signaux à retard (le chantier va démarrer).
 */
import type { ScoreComponent, TempoResult, WeightMap } from "./types";

export type LectureConjoncture = {
  /** Variation relative de la demande récente vs la période précédente, dans [-1, 1]. */
  delta: number;
  /** Missions comptées sur la période, pour le détail. */
  nb: number;
};

/** Appels d'offres publics ouverts sur le bassin portant sur les métiers du lead. */
export type LectureCommandePublique = {
  nb: number;
  /** Le plus proche des échéances, pour le détail. */
  prochaineEcheance: string | null;
};

export type TempoContext = {
  weights: WeightMap;
  now: Date;
  naf: string;
  romesInduits: string[];
  fenetre: { debut: string; fin: string } | null;
  /** Facteur saisonnier du secteur pour le mois courant (1 = neutre). */
  facteurSaison: (naf: string, date: Date) => number;
  /** Lecture BMO du département pour ces métiers. */
  bmo: (romes: string[]) => { partDifficile: number; partSaisonniere: number; projets: number } | null;
  /** Tendance des missions concurrentes du bassin pour ces métiers. */
  conjoncture: (romes: string[]) => LectureConjoncture | null;
  /** Appels d'offres publics ouverts sur le bassin pour ces métiers. */
  commandePublique: (romes: string[]) => LectureCommandePublique | null;
};

function clip(x: number, lo = -1, hi = 1): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(lo, Math.min(hi, x));
}

function pct(x: number): string {
  return `${Math.round(x * 100)} %`;
}

export function computeTempo(ctx: TempoContext): TempoResult {
  const w = ctx.weights;
  const components: ScoreComponent[] = [];
  const lecture = ctx.bmo(ctx.romesInduits);

  // 1. Saison du secteur
  const saison = ctx.facteurSaison(ctx.naf, ctx.now);
  const ampSaison = w["tempo.saison.amplitude"] ?? 0;
  if (ampSaison > 0) {
    // (f - 1) / 0.3 : un mois de pointe à 1,3 vaut +1, un mois creux à 0,7 vaut -1.
    let signalSaison = clip((saison - 1) / 0.3);
    let detail =
      saison > 1.02 ? "mois de pointe pour le secteur" : saison < 0.98 ? "mois creux pour le secteur" : "mois neutre pour le secteur";
    if (lecture && lecture.partSaisonniere > 0) {
      signalSaison *= 0.5 + lecture.partSaisonniere;
      detail += ` · ${pct(lecture.partSaisonniere)} de projets saisonniers pour ces métiers (BMO)`;
    }
    components.push({
      key: "saison",
      labelFr: "Saison",
      contribution: round3(ampSaison * signalSaison),
      max: ampSaison,
      detailFr: detail,
    });
  }

  // 2. Difficultés de recrutement (BMO)
  const ampDiff = w["tempo.difficulte.amplitude"] ?? 0;
  if (ampDiff > 0 && lecture) {
    const signalDiff = clip((lecture.partDifficile - 0.5) / 0.3);
    components.push({
      key: "difficulte",
      labelFr: "Difficulté de recrutement",
      contribution: round3(ampDiff * signalDiff),
      max: ampDiff,
      detailFr: `${pct(lecture.partDifficile)} des projets jugés difficiles dans le département (BMO 2026)`,
    });
  }

  // 3. Conjoncture locale
  const ampConj = w["tempo.conjoncture.amplitude"] ?? 0;
  if (ampConj > 0) {
    const c = ctx.conjoncture(ctx.romesInduits);
    if (c) {
      components.push({
        key: "conjoncture",
        labelFr: "Conjoncture locale",
        contribution: round3(ampConj * clip(c.delta)),
        max: ampConj,
        detailFr:
          c.delta > 0.1
            ? `missions d'intérim en hausse sur le bassin pour ces métiers (${c.nb} sur 90 j)`
            : c.delta < -0.1
              ? `missions d'intérim en baisse sur le bassin pour ces métiers (${c.nb} sur 90 j)`
              : `demande stable sur le bassin (${c.nb} missions sur 90 j)`,
      });
    }
  }

  // 4. Commande publique ouverte sur le bassin
  const ampCp = w["tempo.commande_publique.amplitude"] ?? 0;
  if (ampCp > 0 && ctx.romesInduits.length > 0) {
    const cp = ctx.commandePublique(ctx.romesInduits);
    if (cp && cp.nb > 0) {
      // Une absence d'appel d'offres ne dit rien de négatif : la lecture ne pénalise jamais.
      const signalCp = Math.min(1, cp.nb / Math.max(1, w["tempo.commande_publique.ref"] ?? 3));
      components.push({
        key: "commande_publique",
        labelFr: "Marchés publics en cours",
        contribution: round3(ampCp * signalCp),
        max: ampCp,
        detailFr:
          `${cp.nb} appel${cp.nb > 1 ? "s" : ""} d'offres ouvert${cp.nb > 1 ? "s" : ""} sur ces métiers dans le département` +
          (cp.prochaineEcheance ? `, prochaine remise le ${cp.prochaineEcheance.slice(8, 10)}/${cp.prochaineEcheance.slice(5, 7)}` : ""),
      });
    }
  }

  // 5. Fenêtre d'appel
  const ampFen = w["tempo.fenetre.amplitude"] ?? 0;
  if (ampFen > 0 && ctx.fenetre) {
    const t = ctx.now.getTime();
    const debut = new Date(ctx.fenetre.debut).getTime();
    const fin = new Date(ctx.fenetre.fin).getTime();
    let signalFen = 0;
    let detail: string;
    if (t < debut) {
      const jours = Math.ceil((debut - t) / 86400000);
      signalFen = jours <= 21 ? 0.5 : 0;
      detail = `fenêtre d'appel dans ${jours} jours`;
    } else if (t <= fin) {
      signalFen = 1;
      detail = "dans la fenêtre d'appel : le besoin est attendu maintenant";
    } else {
      signalFen = -0.5;
      detail = "fenêtre d'appel passée";
    }
    components.push({
      key: "fenetre",
      labelFr: "Fenêtre d'appel",
      contribution: round3(ampFen * signalFen),
      max: ampFen,
      detailFr: detail,
    });
  }

  const somme = components.reduce((s, c) => s + c.contribution, 0);
  const min = w["tempo.min"] ?? 0.6;
  const max = w["tempo.max"] ?? 1.4;
  const score = Math.max(min, Math.min(max, 1 + somme));
  return { score: round3(score), components };
}

function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}
