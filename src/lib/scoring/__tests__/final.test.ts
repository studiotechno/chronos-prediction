import { describe, expect, it } from "vitest";
import { computeFinal } from "../final";
import { defaultWeightMap } from "../weights-defaults";

const w = defaultWeightMap();

describe("score final multiplicatif", () => {
  it("applique final = 100 × (strate/100)^α × (sismo/100)^β", () => {
    const { scoreFinal } = computeFinal(80, 60, w);
    const attendu = 100 * Math.pow(0.8, w["final.alpha"]) * Math.pow(0.6, w["final.beta"]);
    expect(scoreFinal).toBeCloseTo(attendu, 1);
  });

  it("un Sismo nul annule le score, quel que soit le Strate", () => {
    expect(computeFinal(95, 0, w).scoreFinal).toBe(0);
  });

  it("un Strate nul annule le score", () => {
    expect(computeFinal(0, 95, w).scoreFinal).toBe(0);
  });
});

describe("règle du seuil chaud", () => {
  it("sismo < seuil → nurturing, même avec un excellent Strate", () => {
    const seuil = w["final.seuil_chaud"];
    expect(computeFinal(95, seuil - 1, w).segment).toBe("nurturing");
    expect(computeFinal(95, seuil, w).segment).toBe("chaud");
  });
});
