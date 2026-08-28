import { describe, expect, it } from "vitest";
import { computeAll, lireCommandePublique, lireConjoncture, type EngineInput } from "../engine";
import { defaultWeightMap } from "../weights-defaults";
import type { EtabScoringInput, SignalScoringInput } from "../types";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();
const AGENCE = {
  lat: 43.3026,
  lon: 5.3691,
  rayonKm: 30,
  romeCibles: ["F1703", "N1101"],
  nafExclus: ["78", "84"],
  departement: "13",
};

function etab(siret: string, partial: Partial<EtabScoringInput> = {}): EtabScoringInput {
  return {
    siret,
    siren: siret.slice(0, 9),
    denomination: `ETAB ${siret}`,
    naf: "43.99C",
    idcc: [],
    trancheEffectif: "21",
    trancheEffectifSource: "sirene",
    effectifEstime: 70,
    caractereEmployeur: "O",
    lat: AGENCE.lat,
    lon: AGENCE.lon,
    codeInsee: null,
    commune: "MARSEILLE",
    dateCreation: "2010-01-01",
    etatAdministratif: "A",
    nbEtabsBassin: 1,
    ca: null,
    caPrecedent: null,
    resultatNet: null,
    icpe: false,
    lbbScore: null,
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
    romes: ["F1703"],
  };
}

function input(partial: Partial<EngineInput>): EngineInput {
  return {
    etablissements: [],
    signauxParSiret: new Map(),
    missionsBassin: [],
    aoOuverts: [],
    agence: AGENCE,
    weights: w,
    tauxRecours: () => ({ tauxPct: 8, detailFr: "8 %" }),
    facteurSaison: () => 1,
    bmo: () => null,
    now: NOW,
    ...partial,
  };
}

describe("orchestration", () => {
  it("score tout le monde mais ne crée un lead que s'il y a un signal positif", () => {
    const out = computeAll(
      input({
        etablissements: [etab("11111111100011"), etab("22222222200011")],
        signauxParSiret: new Map([["11111111100011", [offre("a", 3)]]]),
      }),
    );
    expect(out.strates.size).toBe(2);
    expect(out.tempos.size).toBe(2);
    expect(out.leads).toHaveLength(1);
    expect(out.leads[0].siret).toBe("11111111100011");
    expect(out.leads[0].tempo).toBeGreaterThan(0);
    expect(out.leads[0].romesInduits).toEqual(["F1703"]);
  });

  it("ignore les établissements fermés et les secteurs exclus", () => {
    const out = computeAll(
      input({
        etablissements: [
          etab("11111111100011", { etatAdministratif: "F" }),
          etab("33333333300011", { naf: "78.20Z" }),
          etab("44444444400011", { naf: "84.11Z" }),
        ],
        signauxParSiret: new Map([
          ["11111111100011", [offre("a", 3)]],
          ["33333333300011", [offre("b", 3)]],
          ["44444444400011", [offre("c", 3)]],
        ]),
      }),
    );
    expect(out.strates.size).toBe(0);
    expect(out.leads).toHaveLength(0);
  });

  it("classe par score final décroissant et sépare chaud / nurturing", () => {
    const out = computeAll(
      input({
        etablissements: [etab("11111111100011"), etab("22222222200011")],
        signauxParSiret: new Map([
          // Actif : 3 offres récentes
          ["11111111100011", [offre("a", 1), offre("b", 4), offre("c", 8)]],
          // Presque éteint : une vieille offre
          ["22222222200011", [offre("d", 130)]],
        ]),
      }),
    );
    expect(out.leads[0].siret).toBe("11111111100011");
    expect(out.leads[0].segment).toBe("chaud");
    expect(out.leads[1].segment).toBe("nurturing");
    expect(out.leads[0].scoreFinal).toBeGreaterThan(out.leads[1].scoreFinal);
  });

  it("une procédure collective seule ne fait pas un lead ; avec une offre, elle l'écrase", () => {
    const risque: SignalScoringInput = {
      id: "r",
      type: "BODACC_RISQUE",
      occurredAt: new Date(NOW.getTime() - 20 * 86400000).toISOString(),
      confidence: 1,
      payload: { procedure: "redressement judiciaire" },
    };
    const out = computeAll(
      input({
        etablissements: [etab("11111111100011"), etab("22222222200011"), etab("33333333300011")],
        signauxParSiret: new Map([
          ["11111111100011", [offre("a", 3), risque]],
          ["22222222200011", [offre("b", 3)]],
          ["33333333300011", [risque]],
        ]),
      }),
    );
    expect(out.leads.find((l) => l.siret === "33333333300011")).toBeUndefined();
    const enRJ = out.leads.find((l) => l.siret === "11111111100011")!;
    const sain = out.leads.find((l) => l.siret === "22222222200011")!;
    expect(enRJ.scoreFinal).toBe(0);
    expect(enRJ.segment).toBe("nurturing");
    expect(sain.scoreFinal).toBeGreaterThan(0);
  });

  it("mesure la distance au lieu du besoin, pas au siège", () => {
    const marche: SignalScoringInput = {
      id: "m",
      type: "MARCHE_ATTRIBUE",
      occurredAt: new Date(NOW.getTime() - 10 * 86400000).toISOString(),
      confidence: 1,
      payload: { montant: 480000, cpv: "45233140-2", acheteurNom: "Métropole" },
      lieu: { lat: AGENCE.lat + 0.05, lon: AGENCE.lon, libelle: "Aubagne" },
      romes: ["F1702", "F1302"],
    };
    const out = computeAll(
      input({
        // Siège à Courbevoie, chantier à ~5 km de l'agence
        etablissements: [etab("11111111100011", { lat: 48.897, lon: 2.25 })],
        signauxParSiret: new Map([["11111111100011", [marche]]]),
      }),
    );
    const lead = out.leads[0];
    expect(lead.lieuBesoinFr).toBe("Aubagne");
    expect(lead.distanceBesoinKm).toBeLessThan(10);
    expect(lead.fenetre).not.toBeNull();
    expect(lead.propositionFr).toContain("Proposer");
    expect(lead.propositionFr).toContain("Aubagne");
  });
});

describe("conjoncture locale", () => {
  const mission = (rome: string, joursAvant: number) => ({
    rome,
    occurredAt: new Date(NOW.getTime() - joursAvant * 86400000).toISOString(),
  });

  it("lit une hausse sur les métiers demandés", () => {
    const missions = [
      ...Array.from({ length: 8 }, (_, i) => mission("F1703", 5 + i)),
      ...Array.from({ length: 4 }, (_, i) => mission("F1703", 50 + i)),
      ...Array.from({ length: 5 }, (_, i) => mission("N1101", 50 + i)),
    ];
    const lire = lireConjoncture(missions, NOW);
    const c = lire(["F1703"])!;
    expect(c.delta).toBeGreaterThan(0.5);
    expect(c.nb).toBe(12);
  });

  it("se tait quand la matière manque ou quand la collecte est biaisée", () => {
    expect(lireConjoncture([mission("F1703", 3), mission("F1703", 4)], NOW)(["F1703"])).toBeNull();
    // 20 récentes, 2 anciennes sur tout le bassin : c'est la collecte qui parle
    const biaise = [
      ...Array.from({ length: 20 }, (_, i) => mission("F1703", 1 + i)),
      mission("F1703", 60),
      mission("N1101", 70),
    ];
    expect(lireConjoncture(biaise, NOW)(["F1703"])).toBeNull();
  });
});

describe("commande publique du bassin", () => {
  it("compte les appels d'offres encore ouverts portant sur les métiers demandés", () => {
    const futur = new Date(NOW.getTime() + 20 * 86400000).toISOString();
    const passe = new Date(NOW.getTime() - 5 * 86400000).toISOString();
    const lire = lireCommandePublique(
      [
        { romes: ["F1702", "F1302"], dateLimite: futur },
        { romes: ["F1702"], dateLimite: passe },
        { romes: ["K2204"], dateLimite: futur },
        { romes: [], dateLimite: futur },
      ],
      NOW,
    );
    const voirie = lire(["F1702"])!;
    expect(voirie.nb).toBe(1);
    expect(voirie.prochaineEcheance).toBe(futur);
    expect(lire(["K2204"])!.nb).toBe(1);
    expect(lire(["H2913"])).toBeNull();
    expect(lire([])).toBeNull();
  });
});

describe("portée de l'agence", () => {
  it("un déclencheur identique donne un lead chaud au pied de l'agence, du nurturing hors de portée", () => {
    const manque = (id: string): SignalScoringInput => ({
      id,
      type: "OFFRE_MANQUE_CANDIDATS",
      occurredAt: new Date(NOW.getTime() - 3 * 86400000).toISOString(),
      confidence: 1,
      payload: { intitule: "Maçon (H/F)", rome: "F1703" },
      romes: ["F1703"],
    });
    const out = computeAll(
      input({
        etablissements: [
          etab("11111111100011"), // au pied de l'agence
          etab("99999999900011", { lat: 48.8566, lon: 2.3522 }), // Paris, ~600 km
        ],
        signauxParSiret: new Map([
          ["11111111100011", [manque("a")]],
          ["99999999900011", [manque("b")]],
        ]),
      }),
    );
    const proche = out.leads.find((l) => l.siret === "11111111100011")!;
    const loin = out.leads.find((l) => l.siret === "99999999900011")!;
    expect(proche.segment).toBe("chaud");
    expect(loin.segment).toBe("nurturing");
    // Le lead lointain reste calculé et visible, il ne disparaît pas
    expect(loin.scoreFinal).toBeGreaterThan(0);
  });

  it("un siège lointain avec un chantier proche reste chaud", () => {
    const marche: SignalScoringInput = {
      id: "m",
      type: "MARCHE_ATTRIBUE",
      occurredAt: new Date(NOW.getTime() - 70 * 86400000).toISOString(),
      confidence: 1,
      payload: { montant: 480000, cpv: "45233140-2", objet: "Voirie communale" },
      lieu: { lat: AGENCE.lat + 0.05, lon: AGENCE.lon, libelle: "Aubagne" },
      romes: ["F1702"],
    };
    const out = computeAll(
      input({
        etablissements: [etab("99999999900011", { lat: 48.8566, lon: 2.3522 })],
        signauxParSiret: new Map([["99999999900011", [marche]]]),
      }),
    );
    expect(out.leads[0].segment).toBe("chaud");
    expect(out.leads[0].lieuBesoinFr).toBe("Aubagne");
  });
});
