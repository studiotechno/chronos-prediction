/** Tranches d'effectif salarié INSEE (variable trancheEffectifsEtablissement). */

export type TrancheEffectif = {
  code: string;
  labelFr: string;
  /** Point médian utilisé comme effectif estimé. */
  midpoint: number;
};

export const TRANCHES_EFFECTIF: TrancheEffectif[] = [
  { code: "00", labelFr: "0 salarié", midpoint: 0 },
  { code: "01", labelFr: "1 à 2 salariés", midpoint: 2 },
  { code: "02", labelFr: "3 à 5 salariés", midpoint: 4 },
  { code: "03", labelFr: "6 à 9 salariés", midpoint: 8 },
  { code: "11", labelFr: "10 à 19 salariés", midpoint: 15 },
  { code: "12", labelFr: "20 à 49 salariés", midpoint: 35 },
  { code: "21", labelFr: "50 à 99 salariés", midpoint: 75 },
  { code: "22", labelFr: "100 à 199 salariés", midpoint: 150 },
  { code: "31", labelFr: "200 à 249 salariés", midpoint: 225 },
  { code: "32", labelFr: "250 à 499 salariés", midpoint: 375 },
  { code: "41", labelFr: "500 à 999 salariés", midpoint: 750 },
  { code: "42", labelFr: "1 000 à 1 999 salariés", midpoint: 1500 },
  { code: "51", labelFr: "2 000 à 4 999 salariés", midpoint: 3500 },
  { code: "52", labelFr: "5 000 à 9 999 salariés", midpoint: 7500 },
  { code: "53", labelFr: "10 000 salariés et plus", midpoint: 12000 },
];

const byCode = new Map(TRANCHES_EFFECTIF.map((t) => [t.code, t]));

export function trancheByCode(code: string | null | undefined): TrancheEffectif | undefined {
  return code ? byCode.get(code) : undefined;
}

export function effectifEstime(code: string | null | undefined): number | null {
  return trancheByCode(code)?.midpoint ?? null;
}

/** Ordre croissant des tranches, pour détecter un passage à la tranche supérieure. */
export function trancheRank(code: string): number {
  return TRANCHES_EFFECTIF.findIndex((t) => t.code === code);
}
