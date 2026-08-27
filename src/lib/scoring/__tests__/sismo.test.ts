import { describe, expect, it } from "vitest";
import { computeSismo, normalisationLogistique } from "../sismo";
import { defaultWeightMap } from "../weights-defaults";
import type { SignalScoringInput } from "../types";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();
const ROME_CIBLES = ["N1101", "F1703"];

function signal(partial: Partial<SignalScoringInput> & { type: string }): SignalScoringInput {
  return {
    id: partial.id ?? "s1",
    type: partial.type,
    occurredAt: partial.occurredAt ?? NOW.toISOString(),
    confidence: partial.confidence ?? 1,
    payload: partial.payload ?? {},
  };
}

function ctx() {
  return { weights: w, romeCibles: ROME_CIBLES, now: NOW };
}

function joursAvant(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString();
}

describe("décroissance temporelle", () => {
  it("un signal du jour contribue à plein poids", () => {
    const r = computeSismo([signal({ type: "OFFRE_REPUBLIEE", payload: { rome: "F1703" } })], ctx());
    expect(r.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_REPUBLIEE"], 1);
  });

  it("à une demi-vie d'âge, la contribution est divisée par deux", () => {
    const demiVie = w["sismo.demivie.OFFRE_REPUBLIEE"];
    const r = computeSismo(
      [signal({ type: "OFFRE_REPUBLIEE", occurredAt: joursAvant(demiVie), payload: { rome: "F1703" } })],
      ctx(),
    );
    expect(r.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_REPUBLIEE"] / 2, 1);
  });

  it("la confidence multiplie la contribution", () => {
    const r = computeSismo(
      [signal({ type: "OFFRE_REPUBLIEE", confidence: 0.5, payload: { rome: "F1703" } })],
      ctx(),
    );
    expect(r.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_REPUBLIEE"] / 2, 1);
  });
});

describe("normalisation logistique", () => {
  it("0 contribution → score 0", () => {
    expect(normalisationLogistique(0, w)).toBe(0);
    expect(computeSismo([], ctx()).score).toBe(0);
  });

  it("somme négative → score 0", () => {
    expect(normalisationLogistique(-30, w)).toBe(0);
  });

  it("croissante et bornée à 100 : 50 offres n'écrasent pas le classement", () => {
    const s40 = normalisationLogistique(40, w);
    const s80 = normalisationLogistique(80, w);
    const s600 = normalisationLogistique(600, w);
    expect(s80).toBeGreaterThan(s40);
    expect(s600).toBeLessThanOrEqual(100);
    // rendements décroissants : +40 points de somme rapportent moins la deuxième fois
    expect(s80 - s40).toBeLessThan(s40);
  });
});

describe("facteurs métier", () => {
  it("une offre hors ROME cibles est fortement amortie", () => {
    const dans = computeSismo(
      [signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })],
      ctx(),
    );
    const hors = computeSismo(
      [signal({ type: "OFFRE_DIRECTE", payload: { rome: "M1402" } })],
      ctx(),
    );
    expect(hors.contributions[0].contribution).toBeCloseTo(
      dans.contributions[0].contribution * w["sismo.rome_hors_cible"],
      2,
    );
  });

  it("un marché est pondéré par son montant", () => {
    const gros = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    const petit = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 100000, cpv: "45233140-2" } })],
      ctx(),
    );
    expect(petit.contributions[0].contribution).toBeCloseTo(
      gros.contributions[0].contribution * (100000 / 500000),
      1,
    );
  });

  it("un CPV hors cible est amorti", () => {
    const btp = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    const info = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "72000000-5" } })],
      ctx(),
    );
    expect(info.contributions[0].contribution).toBeCloseTo(
      btp.contributions[0].contribution * w["sismo.marche.cpv_hors_cible"],
      2,
    );
  });
});

describe("signaux négatifs", () => {
  it("une procédure collective annule le Sismo d'une entreprise moyennement active", () => {
    const r = computeSismo(
      [
        signal({ id: "a", type: "OFFRE_DIRECTE", payload: { rome: "F1703" } }),
        signal({ id: "b", type: "BODACC_RISQUE", payload: { procedure: "redressement judiciaire" } }),
      ],
      ctx(),
    );
    expect(r.sommeBrute).toBeLessThan(0);
    expect(r.score).toBe(0);
  });
});

describe("MISSION_CONCURRENT", () => {
  it("ne score pas l'entreprise (poids 0)", () => {
    const r = computeSismo([signal({ type: "MISSION_CONCURRENT", payload: { rome: "F1703" } })], ctx());
    expect(r.contributions).toHaveLength(0);
    expect(r.score).toBe(0);
  });
});
