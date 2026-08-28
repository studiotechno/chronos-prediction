import { describe, expect, it } from "vitest";
import { nombreFini } from "../nombre";

/**
 * Le cas qui a motivé ce module : l'API recherche-entreprises renvoie la chaîne
 * « [NON-DIFFUSIBLE] » dans les champs latitude / longitude des entreprises à
 * diffusion restreinte. `Number(...)` en faisait un NaN stocké en base.
 */
describe("nombreFini", () => {
  it("rend null sur les marqueurs non numériques de SIRENE", () => {
    expect(nombreFini("[NON-DIFFUSIBLE]")).toBeNull();
    expect(nombreFini("[ND]")).toBeNull();
    expect(nombreFini("N/A")).toBeNull();
  });

  it("rend null sur l'absence de valeur", () => {
    expect(nombreFini(null)).toBeNull();
    expect(nombreFini(undefined)).toBeNull();
    expect(nombreFini("")).toBeNull();
  });

  it("rend null sur les nombres non finis", () => {
    expect(nombreFini(NaN)).toBeNull();
    expect(nombreFini(Infinity)).toBeNull();
    expect(nombreFini(-Infinity)).toBeNull();
  });

  it("conserve les coordonnées valides, zéro et négatifs compris", () => {
    expect(nombreFini("46.5591")).toBe(46.5591);
    expect(nombreFini("-3.3255")).toBe(-3.3255);
    expect(nombreFini("0")).toBe(0);
    expect(nombreFini(46.5591)).toBe(46.5591);
  });

  it("ne rend jamais NaN, quelle que soit l'entrée", () => {
    for (const v of ["[NON-DIFFUSIBLE]", "", "abc", null, undefined, NaN, {}, [], true]) {
      const r = nombreFini(v);
      expect(r === null || Number.isFinite(r)).toBe(true);
    }
  });
});
