import { describe, expect, it } from "vitest";
import { computeStrate, estimerTaille, type StrateContext } from "../strate";
import { defaultWeightMap } from "../weights-defaults";
import type { EtabScoringInput } from "../types";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();

const AGENCE = { lat: 43.3026, lon: 5.3691, rayonKm: 30, romeCibles: [], nafCibles: [], nafExclus: [] };

function etab(partial: Partial<EtabScoringInput>): EtabScoringInput {
  return {
    siret: "12345678900011",
    siren: "123456789",
    denomination: "TEST",
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

const taux = (t: number) => () => ({ tauxPct: t, detailFr: `taux ${t} %` });

function ctx(partial: Partial<StrateContext> = {}): StrateContext {
  return {
    agence: AGENCE,
    weights: w,
    tauxRecours: taux(8),
    aProcedureCollective: false,
    aRestructuration: false,
    lieuBesoin: null,
    now: NOW,
    ...partial,
  };
}

function composante(r: ReturnType<typeof computeStrate>, key: string) {
  return r.components.find((c) => c.key === key)!;
}

describe("composante secteur (IDCC / DARES)", () => {
  it("sature au taux de référence", () => {
    const a8 = composante(computeStrate(etab({}), ctx({ tauxRecours: taux(8) })), "naf");
    const a16 = composante(computeStrate(etab({}), ctx({ tauxRecours: taux(16) })), "naf");
    expect(a8.contribution).toBeCloseTo(w["strate.naf.max"], 1);
    expect(a16.contribution).toBeCloseTo(w["strate.naf.max"], 1);
  });

  it("est proportionnelle sous le taux de référence", () => {
    const a4 = composante(computeStrate(etab({}), ctx({ tauxRecours: taux(4) })), "naf");
    expect(a4.contribution).toBeCloseTo(w["strate.naf.max"] / 2, 1);
  });

  it("vaut 0 pour un secteur exclu (agence d'intérim)", () => {
    const r = composante(
      computeStrate(etab({}), ctx({ tauxRecours: () => ({ tauxPct: 0, detailFr: "exclu", exclu: true }) })),
      "naf",
    );
    expect(r.contribution).toBe(0);
  });
});

describe("cascade de taille", () => {
  it("est maximale au centre (≈70 salariés)", () => {
    const r = composante(computeStrate(etab({ effectifEstime: 70 }), ctx()), "effectif");
    expect(r.contribution).toBeCloseTo(w["strate.effectif.max"], 1);
    expect(r.detailFr).toContain("INSEE");
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

  it("dit d'où vient la tranche quand France Travail l'a fournie", () => {
    const t = estimerTaille(etab({ trancheEffectifSource: "francetravail" }), w);
    expect(t.detailFr).toContain("France Travail");
  });

  it("estime la taille sur le chiffre d'affaires quand la tranche est inconnue", () => {
    // 43.99C (construction) : ~130 k€ de CA par salarié → 9,1 M€ ≈ 70 salariés
    const t = estimerTaille(etab({ trancheEffectif: null, effectifEstime: null, ca: 9_100_000 }), w);
    expect(t.effectif).toBeGreaterThan(50);
    expect(t.effectif).toBeLessThan(90);
    expect(t.contribution).toBeGreaterThan(w["strate.effectif.max"] * 0.9);
    expect(t.detailFr).toContain("estimé sur un CA");
  });

  it("accorde le prior « employeur » sans tranche ni CA, et rien à un non-employeur", () => {
    const employeur = estimerTaille(etab({ trancheEffectif: null, effectifEstime: null, caractereEmployeur: "O" }), w);
    expect(employeur.contribution).toBeCloseTo(w["strate.effectif.max"] * w["strate.effectif.prior_inconnu"], 2);
    const non = estimerTaille(etab({ trancheEffectif: null, effectifEstime: null, caractereEmployeur: "N" }), w);
    expect(non.contribution).toBe(0);
    expect(non.detailFr).toContain("Sans salarié");
  });

  it("une tranche 00 (0 salarié) vaut 0", () => {
    const t = estimerTaille(etab({ trancheEffectif: "00", effectifEstime: 0 }), w);
    expect(t.contribution).toBe(0);
  });
});

describe("proximité du besoin", () => {
  it("est maximale au pied de l'agence et décroît exponentiellement", () => {
    const proche = composante(computeStrate(etab({}), ctx()), "distance");
    expect(proche.contribution).toBeCloseTo(w["strate.distance.max"], 1);

    // ~0.27° de latitude ≈ 30 km au nord
    const loin = composante(computeStrate(etab({ lat: AGENCE.lat + 0.27 }), ctx()), "distance");
    expect(loin.contribution).toBeLessThan(proche.contribution / 5);
  });

  it("préfère le lieu du besoin quand il est plus proche que l'établissement", () => {
    // Siège à 350 km (Courbevoie), chantier à 8 km de l'agence
    const r = computeStrate(
      etab({ lat: 48.897, lon: 2.25 }),
      ctx({ lieuBesoin: { km: 8, libelle: "Saint-Pourçain-sur-Sioule" } }),
    );
    const d = composante(r, "distance");
    expect(r.distanceKm).toBe(8);
    expect(r.lieuFr).toBe("Saint-Pourçain-sur-Sioule");
    expect(d.detailFr).toContain("besoin à Saint-Pourçain-sur-Sioule");
    expect(d.detailFr).toContain("établissement à");
    expect(d.contribution).toBeGreaterThan(w["strate.distance.max"] * 0.4);
  });

  it("garde l'établissement quand le besoin est plus loin", () => {
    const r = computeStrate(etab({}), ctx({ lieuBesoin: { km: 120, libelle: "Ailleurs" } }));
    expect(r.lieuFr).toBeNull();
    expect(composante(r, "distance").detailFr).toContain("de l'agence");
  });
});

describe("santé sur comptes déposés", () => {
  it("un résultat net négatif et un CA en baisse réduisent la composante", () => {
    const sain = composante(computeStrate(etab({ resultatNet: 50000, ca: 2_000_000, caPrecedent: 1_900_000 }), ctx()), "sante");
    const fragile = composante(
      computeStrate(etab({ resultatNet: -50000, ca: 1_500_000, caPrecedent: 2_000_000 }), ctx()),
      "sante",
    );
    expect(sain.contribution).toBeCloseTo(w["strate.sante.max"], 1);
    expect(fragile.contribution).toBeCloseTo(
      w["strate.sante.max"] * w["strate.sante.malus_resultat_negatif"] * w["strate.sante.malus_ca_baisse"],
      1,
    );
    expect(fragile.detailFr).toContain("résultat net négatif");
    expect(fragile.detailFr).toContain("CA en baisse de 25 %");
  });

  it("sans comptes, la composante vaut 85 % du max (comme avant)", () => {
    const r = composante(computeStrate(etab({}), ctx()), "sante");
    expect(r.contribution).toBeCloseTo(w["strate.sante.max"] * 0.85, 1);
  });

  it("un accord de restructuration pèse sur la santé", () => {
    const r = composante(computeStrate(etab({ resultatNet: 1000 }), ctx({ aRestructuration: true })), "sante");
    expect(r.contribution).toBeCloseTo(w["strate.sante.max"] * w["strate.sante.malus_restructuration"], 1);
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

describe("site et potentiel d'embauche", () => {
  it("un site ICPE apporte le bonus configuré", () => {
    expect(composante(computeStrate(etab({ icpe: true }), ctx()), "site").contribution).toBe(w["strate.site.icpe"]);
    expect(computeStrate(etab({}), ctx()).components.find((c) => c.key === "site")).toBeUndefined();
  });

  it("le score La Bonne Boîte est proportionnel aux étoiles", () => {
    const cinq = composante(computeStrate(etab({ lbbScore: 5 }), ctx()), "lbb");
    const deux = composante(computeStrate(etab({ lbbScore: 2 }), ctx()), "lbb");
    expect(cinq.contribution).toBe(w["strate.lbb.max"]);
    expect(deux.contribution).toBeCloseTo(w["strate.lbb.max"] * 0.4, 2);
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
    const top = computeStrate(
      etab({ nbEtabsBassin: 10, icpe: true, lbbScore: 5, resultatNet: 1 }),
      ctx({ tauxRecours: taux(20) }),
    );
    expect(top.score).toBeLessThanOrEqual(100);
    expect(top.score).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Régression observée en production : SIRENE publie « [NON-DIFFUSIBLE] » comme
 * latitude pour les entreprises à diffusion restreinte. Le NaN qui en résultait
 * traversait la distance, le Strate, le score final, était persisté, et faisait
 * planter la carte des leads avec « Invalid LngLat object: (NaN, NaN) ».
 */
describe("position non finie", () => {
  it("traite NaN comme une position inconnue, jamais comme une distance", () => {
    const r = computeStrate(etab({ lat: NaN, lon: NaN }), ctx());
    const dist = composante(r, "distance");
    expect(dist.contribution).toBe(0);
    expect(dist.detailFr).toBe("Coordonnées inconnues");
  });

  it("ne produit jamais un score NaN", () => {
    for (const position of [
      { lat: NaN, lon: NaN },
      { lat: NaN, lon: 3.3255 },
      { lat: 46.5591, lon: NaN },
      { lat: Infinity, lon: Infinity },
      { lat: null, lon: null },
    ]) {
      const r = computeStrate(etab(position), ctx());
      expect(Number.isFinite(r.score), `score fini pour ${JSON.stringify(position)}`).toBe(true);
      for (const c of r.components) {
        expect(Number.isFinite(c.contribution), `composante ${c.key} finie`).toBe(true);
      }
    }
  });

  it("donne le même score qu'une position absente", () => {
    expect(computeStrate(etab({ lat: NaN, lon: NaN }), ctx()).score).toBe(
      computeStrate(etab({ lat: null, lon: null }), ctx()).score,
    );
  });
});
