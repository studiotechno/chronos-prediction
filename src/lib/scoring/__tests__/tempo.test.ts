import { describe, expect, it } from "vitest";
import { computeTempo, type TempoContext } from "../tempo";
import { defaultWeightMap } from "../weights-defaults";

const NOW = new Date("2026-08-27T12:00:00Z");
const w = defaultWeightMap();

function ctx(partial: Partial<TempoContext> = {}): TempoContext {
  return {
    weights: w,
    now: NOW,
    naf: "43.99C",
    romesInduits: ["F1703"],
    fenetre: null,
    facteurSaison: () => 1,
    bmo: () => null,
    conjoncture: () => null,
    commandePublique: () => null,
    ...partial,
  };
}

function composante(r: ReturnType<typeof computeTempo>, key: string) {
  return r.components.find((c) => c.key === key);
}

describe("Tempo", () => {
  it("vaut 1 quand rien ne parle", () => {
    const r = computeTempo(ctx());
    expect(r.score).toBe(1);
    expect(composante(r, "saison")?.contribution).toBe(0);
    expect(composante(r, "difficulte")).toBeUndefined();
    expect(composante(r, "conjoncture")).toBeUndefined();
    expect(composante(r, "fenetre")).toBeUndefined();
  });

  it("monte en saison de pointe et descend en saison creuse", () => {
    const pointe = computeTempo(ctx({ facteurSaison: () => 1.3 }));
    const creux = computeTempo(ctx({ facteurSaison: () => 0.7 }));
    expect(composante(pointe, "saison")!.contribution).toBeCloseTo(w["tempo.saison.amplitude"], 3);
    expect(composante(creux, "saison")!.contribution).toBeCloseTo(-w["tempo.saison.amplitude"], 3);
    expect(pointe.score).toBeGreaterThan(1);
    expect(creux.score).toBeLessThan(1);
  });

  it("lit la difficulté de recrutement du département (BMO)", () => {
    const dur = computeTempo(ctx({ bmo: () => ({ partDifficile: 0.8, partSaisonniere: 0.1, projets: 500 }) }));
    const facile = computeTempo(ctx({ bmo: () => ({ partDifficile: 0.2, partSaisonniere: 0.1, projets: 500 }) }));
    expect(composante(dur, "difficulte")!.contribution).toBeCloseTo(w["tempo.difficulte.amplitude"], 3);
    expect(composante(facile, "difficulte")!.contribution).toBeCloseTo(-w["tempo.difficulte.amplitude"], 3);
    expect(composante(dur, "difficulte")!.detailFr).toContain("80 %");
  });

  it("suit la conjoncture locale des missions d'intérim", () => {
    const hausse = computeTempo(ctx({ conjoncture: () => ({ delta: 1, nb: 12 }) }));
    expect(composante(hausse, "conjoncture")!.contribution).toBeCloseTo(w["tempo.conjoncture.amplitude"], 3);
    expect(composante(hausse, "conjoncture")!.detailFr).toContain("hausse");
  });

  it("récompense la fenêtre d'appel quand on y est, pénalise quand elle est passée", () => {
    const jour = 86400000;
    const dedans = computeTempo(
      ctx({ fenetre: { debut: new Date(NOW.getTime() - 5 * jour).toISOString(), fin: new Date(NOW.getTime() + 20 * jour).toISOString() } }),
    );
    const bientot = computeTempo(
      ctx({ fenetre: { debut: new Date(NOW.getTime() + 10 * jour).toISOString(), fin: new Date(NOW.getTime() + 40 * jour).toISOString() } }),
    );
    const loin = computeTempo(
      ctx({ fenetre: { debut: new Date(NOW.getTime() + 90 * jour).toISOString(), fin: new Date(NOW.getTime() + 120 * jour).toISOString() } }),
    );
    const passee = computeTempo(
      ctx({ fenetre: { debut: new Date(NOW.getTime() - 60 * jour).toISOString(), fin: new Date(NOW.getTime() - 10 * jour).toISOString() } }),
    );
    expect(composante(dedans, "fenetre")!.contribution).toBeCloseTo(w["tempo.fenetre.amplitude"], 3);
    expect(composante(bientot, "fenetre")!.contribution).toBeCloseTo(w["tempo.fenetre.amplitude"] / 2, 3);
    expect(composante(loin, "fenetre")!.contribution).toBe(0);
    expect(composante(passee, "fenetre")!.contribution).toBeLessThan(0);
  });

  it("reste borné : il ordonne, il ne décide pas", () => {
    const tout = computeTempo(
      ctx({
        facteurSaison: () => 2,
        bmo: () => ({ partDifficile: 1, partSaisonniere: 1, projets: 500 }),
        conjoncture: () => ({ delta: 1, nb: 50 }),
        fenetre: { debut: new Date(NOW.getTime() - 1).toISOString(), fin: new Date(NOW.getTime() + 1e9).toISOString() },
      }),
    );
    expect(tout.score).toBeLessThanOrEqual(w["tempo.max"]);
    const rien = computeTempo(
      ctx({ facteurSaison: () => 0.1, bmo: () => ({ partDifficile: 0, partSaisonniere: 0, projets: 500 }), conjoncture: () => ({ delta: -1, nb: 50 }) }),
    );
    expect(rien.score).toBeGreaterThanOrEqual(w["tempo.min"]);
  });
});

describe("Tempo — commande publique ouverte", () => {
  it("récompense les appels d'offres en cours sur les métiers du lead", () => {
    const un = computeTempo(ctx({ commandePublique: () => ({ nb: 1, prochaineEcheance: "2026-09-28T10:00:00Z" }) }));
    const trois = computeTempo(ctx({ commandePublique: () => ({ nb: 3, prochaineEcheance: null }) }));
    expect(composante(un, "commande_publique")!.contribution).toBeCloseTo(
      w["tempo.commande_publique.amplitude"] / w["tempo.commande_publique.ref"],
      3,
    );
    expect(composante(trois, "commande_publique")!.contribution).toBeCloseTo(w["tempo.commande_publique.amplitude"], 3);
    expect(composante(un, "commande_publique")!.detailFr).toContain("28/09");
  });

  it("ne pénalise jamais l'absence d'appel d'offres", () => {
    const r = computeTempo(ctx({ commandePublique: () => null }));
    expect(composante(r, "commande_publique")).toBeUndefined();
    expect(r.score).toBe(1);
  });
});
