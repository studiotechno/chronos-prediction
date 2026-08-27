import { describe, expect, it } from "vitest";
import { computeStrate, type StrateContext } from "../strate";
import { defaultWeightMap } from "../weights-defaults";
import type { EtabScoringInput } from "../types";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();

const AGENCE = { lat: 43.3026, lon: 5.3691, rayonKm: 30, romeCibles: [] };

function etab(partial: Partial<EtabScoringInput>): EtabScoringInput {
  return {
    siret: "12345678900011",
    siren: "123456789",
    denomination: "TEST",
    naf: "43.99C",
    effectifEstime: 70,
    lat: AGENCE.lat,
    lon: AGENCE.lon,
    dateCreation: "2010-01-01",
    etatAdministratif: "A",
    nbEtabsBassin: 1,
    ...partial,
  };
}

function ctx(partial: Partial<StrateContext> = {}): StrateContext {
  return {
    agence: AGENCE,
    weights: w,
    tauxRecours: () => 8,
    aProcedureCollective: false,
    aDepotComptes: false,
    now: NOW,
    ...partial,
  };
}

function composante(r: ReturnType<typeof computeStrate>, key: string) {
  return r.components.find((c) => c.key === key)!;
}

describe("composante secteur (DARES)", () => {
  it("sature au taux de référence", () => {
    const a8 = composante(computeStrate(etab({}), ctx({ tauxRecours: () => 8 })), "naf");
    const a16 = composante(computeStrate(etab({}), ctx({ tauxRecours: () => 16 })), "naf");
    expect(a8.contribution).toBeCloseTo(w["strate.naf.max"], 1);
    expect(a16.contribution).toBeCloseTo(w["strate.naf.max"], 1);
  });

  it("est proportionnelle sous le taux de référence", () => {
    const a4 = composante(computeStrate(etab({}), ctx({ tauxRecours: () => 4 })), "naf");
    expect(a4.contribution).toBeCloseTo(w["strate.naf.max"] / 2, 1);
  });
});

describe("cloche d'effectif", () => {
  it("est maximale au centre (≈70 salariés)", () => {
    const r = composante(computeStrate(etab({ effectifEstime: 70 }), ctx()), "effectif");
    expect(r.contribution).toBeCloseTo(w["strate.effectif.max"], 1);
  });

  it("vaut ~60 % du max aux bornes 20 et 250 de la cible", () => {
    const a20 = composante(computeStrate(etab({ effectifEstime: 20 }), ctx()), "effectif");
    const a250 = composante(computeStrate(etab({ effectifEstime: 250 }), ctx()), "effectif");
    for (const c of [a20, a250]) {
      expect(c.contribution).toBeGreaterThan(w["strate.effectif.max"] * 0.5);
      expect(c.contribution).toBeLessThan(w["strate.effectif.max"] * 0.75);
    }
  });

  it("pénalise les très grandes structures", () => {
    const a3000 = composante(computeStrate(etab({ effectifEstime: 3000 }), ctx()), "effectif");
    expect(a3000.contribution).toBeLessThan(w["strate.effectif.max"] * 0.15);
  });

  it("effectif inconnu → 0", () => {
    const r = composante(computeStrate(etab({ effectifEstime: null }), ctx()), "effectif");
    expect(r.contribution).toBe(0);
  });
});

describe("distance à l'agence", () => {
  it("est maximale au pied de l'agence et décroît exponentiellement", () => {
    const proche = composante(computeStrate(etab({}), ctx()), "distance");
    expect(proche.contribution).toBeCloseTo(w["strate.distance.max"], 1);

    // ~0.09° de latitude ≈ 10 km au nord
    const loin = composante(computeStrate(etab({ lat: AGENCE.lat + 0.27 }), ctx()), "distance");
    expect(loin.contribution).toBeLessThan(proche.contribution / 5);
  });
});

describe("malus procédure collective", () => {
  it("est multiplicatif, pas additif", () => {
    const sain = computeStrate(etab({}), ctx());
    const enRJ = computeStrate(etab({}), ctx({ aProcedureCollective: true }));
    const sommeAvantMalus = enRJ.components
      .filter((c) => c.key !== "sante.malus")
      .reduce((s, c) => s + c.contribution, 0);
    expect(enRJ.score).toBeCloseTo(sommeAvantMalus * w["strate.sante.malus_procedure"], 1);
    expect(enRJ.score).toBeLessThan(sain.score / 2);
  });
});

describe("bonus multi-établissements", () => {
  it("est plafonné", () => {
    const deux = composante(computeStrate(etab({ nbEtabsBassin: 2 }), ctx()), "multi_etab");
    expect(deux.contribution).toBe(w["strate.multi_etab.bonus"]);
    const dix = composante(computeStrate(etab({ nbEtabsBassin: 10 }), ctx()), "multi_etab");
    expect(dix.contribution).toBe(w["strate.multi_etab.max"]);
  });
});

describe("bornes", () => {
  it("le score reste dans [0, 100]", () => {
    const top = computeStrate(etab({ nbEtabsBassin: 10 }), ctx({ tauxRecours: () => 20 }));
    expect(top.score).toBeLessThanOrEqual(100);
    expect(top.score).toBeGreaterThanOrEqual(0);
  });
});
