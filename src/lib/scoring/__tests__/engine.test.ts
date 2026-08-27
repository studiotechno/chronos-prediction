import { describe, expect, it } from "vitest";
import { computeAll } from "../engine";
import { defaultWeightMap } from "../weights-defaults";
import type { EtabScoringInput, SignalScoringInput } from "../types";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();
const AGENCE = { lat: 43.3026, lon: 5.3691, rayonKm: 30, romeCibles: ["F1703", "N1101"] };

function etab(siret: string, partial: Partial<EtabScoringInput> = {}): EtabScoringInput {
  return {
    siret,
    siren: siret.slice(0, 9),
    denomination: `ETAB ${siret}`,
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

function offre(id: string, joursAvant: number): SignalScoringInput {
  return {
    id,
    type: "OFFRE_DIRECTE",
    occurredAt: new Date(NOW.getTime() - joursAvant * 86400000).toISOString(),
    confidence: 0.9,
    payload: { intitule: "Maçon (H/F)", rome: "F1703", typeContrat: "CDI" },
  };
}

describe("orchestration", () => {
  it("score tout le monde mais ne crée un lead que s'il y a un signal", () => {
    const out = computeAll({
      etablissements: [etab("11111111100011"), etab("22222222200011")],
      signauxParSiret: new Map([["11111111100011", [offre("a", 3)]]]),
      agence: AGENCE,
      weights: w,
      tauxRecours: () => 8,
      now: NOW,
    });
    expect(out.strates.size).toBe(2);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0].siret).toBe("11111111100011");
  });

  it("ignore les établissements fermés", () => {
    const out = computeAll({
      etablissements: [etab("11111111100011", { etatAdministratif: "F" })],
      signauxParSiret: new Map([["11111111100011", [offre("a", 3)]]]),
      agence: AGENCE,
      weights: w,
      tauxRecours: () => 8,
      now: NOW,
    });
    expect(out.strates.size).toBe(0);
    expect(out.leads).toHaveLength(0);
  });

  it("classe par score final décroissant et sépare chaud / nurturing", () => {
    const out = computeAll({
      etablissements: [etab("11111111100011"), etab("22222222200011")],
      signauxParSiret: new Map([
        // Actif : 3 offres récentes
        ["11111111100011", [offre("a", 1), offre("b", 4), offre("c", 8)]],
        // Presque éteint : une vieille offre
        ["22222222200011", [offre("d", 130)]],
      ]),
      agence: AGENCE,
      weights: w,
      tauxRecours: () => 8,
      now: NOW,
    });
    expect(out.leads[0].siret).toBe("11111111100011");
    expect(out.leads[0].segment).toBe("chaud");
    expect(out.leads[1].segment).toBe("nurturing");
    expect(out.leads[0].scoreFinal).toBeGreaterThan(out.leads[1].scoreFinal);
  });

  it("une procédure collective écrase le score malgré un bon fit", () => {
    const risque: SignalScoringInput = {
      id: "r",
      type: "BODACC_RISQUE",
      occurredAt: new Date(NOW.getTime() - 20 * 86400000).toISOString(),
      confidence: 1,
      payload: { procedure: "redressement judiciaire" },
    };
    const out = computeAll({
      etablissements: [etab("11111111100011"), etab("22222222200011")],
      signauxParSiret: new Map([
        ["11111111100011", [offre("a", 3), risque]],
        ["22222222200011", [offre("b", 3)]],
      ]),
      agence: AGENCE,
      weights: w,
      tauxRecours: () => 8,
      now: NOW,
    });
    const enRJ = out.leads.find((l) => l.siret === "11111111100011")!;
    const sain = out.leads.find((l) => l.siret === "22222222200011")!;
    expect(enRJ.scoreFinal).toBe(0);
    expect(enRJ.segment).toBe("nurturing");
    expect(sain.scoreFinal).toBeGreaterThan(0);
  });
});
