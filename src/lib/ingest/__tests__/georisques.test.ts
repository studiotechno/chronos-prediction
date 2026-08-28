import { describe, expect, it } from "vitest";
import { centresCouverture, estSiteClasseActif, georisquesAdapter, RAYON_MAX_M } from "../adapters/georisques";

describe("Géorisques — couverture", () => {
  it("un rayon sous le plafond de l'API tient en un seul centre", () => {
    expect(centresCouverture(46.566, 3.333, 10)).toEqual([{ lat: 46.566, lon: 3.333 }]);
    expect(centresCouverture(46.566, 3.333, RAYON_MAX_M / 1000)).toHaveLength(1);
  });

  it("un rayon plus large est couvert par une grille de centres autour de l'agence", () => {
    const centres = centresCouverture(46.566, 3.333, 30);
    expect(centres.length).toBeGreaterThan(1);
    expect(centres).toContainEqual({ lat: 46.566, lon: 3.333 });
    for (const c of centres) {
      const dLat = (c.lat - 46.566) * 111.32;
      const dLon = (c.lon - 3.333) * 111.32 * Math.cos((46.566 * Math.PI) / 180);
      expect(Math.hypot(dLat, dLon)).toBeLessThanOrEqual(30 + RAYON_MAX_M / 1000 + 0.5);
    }
  });
});

describe("Géorisques — normalisation", () => {
  const [enActivite, fermee, nonIcpe] = georisquesAdapter.fixture();

  it("un site classé en exploitation pose l'attribut ICPE avec son régime", () => {
    expect(estSiteClasseActif(enActivite)).toBe(true);
    const records = georisquesAdapter.normalize(enActivite);
    expect(records).toEqual([
      { kind: "attribut", siret: "90090000200018", attributs: { icpe: 1, icpeRegime: "Enregistrement" } },
    ]);
  });

  it("un site en fin d'exploitation ou hors ICPE ne produit rien", () => {
    expect(georisquesAdapter.normalize(fermee)).toHaveLength(0);
    expect(georisquesAdapter.normalize(nonIcpe)).toHaveLength(0);
  });

  it("un site sans SIRET valide est ignoré, un état d'activité nul est accepté", () => {
    expect(georisquesAdapter.normalize({ ...enActivite, siret: null })).toHaveLength(0);
    expect(georisquesAdapter.normalize({ ...enActivite, siret: "123" })).toHaveLength(0);
    expect(georisquesAdapter.normalize({ ...enActivite, etatActivite: null })).toHaveLength(1);
  });
});
