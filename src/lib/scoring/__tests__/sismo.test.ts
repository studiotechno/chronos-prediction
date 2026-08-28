import { describe, expect, it } from "vitest";
import { computeSismo, normalisationLogistique, noyau } from "../sismo";
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
    lieu: partial.lieu ?? null,
    romes: partial.romes ?? null,
  };
}

function ctx(partial: Partial<Parameters<typeof computeSismo>[1]> = {}) {
  return { weights: w, romeCibles: ROME_CIBLES, tauxSecteurPct: 8, now: NOW, ...partial };
}

function joursAvant(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString();
}

describe("noyau immédiat", () => {
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

describe("noyau à retard (marché attribué, permis)", () => {
  it("vaut le plancher le jour J, 1 au pic, et redescend ensuite", () => {
    const pic = w["sismo.pic.MARCHE_ATTRIBUE"];
    const j0 = noyau("MARCHE_ATTRIBUE", NOW.toISOString(), w, NOW);
    const auPic = noyau("MARCHE_ATTRIBUE", joursAvant(pic), w, NOW);
    const apres = noyau("MARCHE_ATTRIBUE", joursAvant(pic * 4), w, NOW);
    expect(j0.valeur).toBeCloseTo(w["sismo.plancher_retard"], 2);
    expect(auPic.valeur).toBeGreaterThan(0.95);
    expect(apres.valeur).toBeLessThan(auPic.valeur / 2);
    expect(j0.picAt?.slice(0, 10)).toBe(new Date(NOW.getTime() + pic * 86400000).toISOString().slice(0, 10));
  });

  it("expose une fenêtre d'appel autour du pic, seulement si elle n'est pas passée", () => {
    const frais = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    expect(frais.fenetre).not.toBeNull();
    expect(new Date(frais.fenetre!.debut).getTime()).toBeGreaterThan(NOW.getTime());
    const ancien = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", occurredAt: joursAvant(600), payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    expect(ancien.fenetre).toBeNull();
  });

  it("un marché frais pèse moins qu'un marché à son pic — le chantier n'a pas commencé", () => {
    const frais = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    const auPic = computeSismo(
      [
        signal({
          type: "MARCHE_ATTRIBUE",
          occurredAt: joursAvant(w["sismo.pic.MARCHE_ATTRIBUE"]),
          payload: { montant: 500000, cpv: "45233140-2" },
        }),
      ],
      ctx(),
    );
    expect(frais.contributions[0].contribution).toBeLessThan(auPic.contributions[0].contribution);
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

describe("facteurs métier et secteur", () => {
  it("une offre hors ROME cibles est fortement amortie", () => {
    const dans = computeSismo([signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })], ctx());
    const hors = computeSismo([signal({ type: "OFFRE_DIRECTE", payload: { rome: "M1402" } })], ctx());
    expect(hors.contributions[0].contribution).toBeCloseTo(
      dans.contributions[0].contribution * w["sismo.rome_hors_cible"],
      2,
    );
  });

  it("les métiers induits (romes) priment sur le payload", () => {
    const r = computeSismo([signal({ type: "OFFRE_DIRECTE", romes: ["F1703"], payload: { rome: "M1402" } })], ctx());
    expect(r.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_DIRECTE"], 1);
    expect(r.romesInduits).toEqual(["F1703"]);
  });

  it("le supermarché à 12 offres est amorti par l'intensité intérim de son secteur", () => {
    const btp = computeSismo([signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })], ctx({ tauxSecteurPct: 8 }));
    const commerce = computeSismo(
      [signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })],
      ctx({ tauxSecteurPct: 1.8 }),
    );
    expect(commerce.contributions[0].contribution).toBeCloseTo(
      btp.contributions[0].contribution * (1.8 / w["strate.naf.taux_ref"]),
      2,
    );
    // mais jamais sous le plancher
    const nul = computeSismo([signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })], ctx({ tauxSecteurPct: 0 }));
    expect(nul.contributions[0].contribution).toBeCloseTo(
      btp.contributions[0].contribution * w["sismo.secteur.plancher"],
      2,
    );
  });

  it("le secteur ne touche pas aux marchés publics ni aux accords", () => {
    const a = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx({ tauxSecteurPct: 8 }),
    );
    const b = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx({ tauxSecteurPct: 1 }),
    );
    expect(a.contributions[0].contribution).toBe(b.contributions[0].contribution);
  });

  it("un marché est pondéré par son montant, et un montant inconnu compte pour 0,6", () => {
    const gros = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    const petit = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 100000, cpv: "45233140-2" } })],
      ctx(),
    );
    const inconnu = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", romes: ["F1702"], payload: { montant: null, acheteurNom: "Ville" } })],
      ctx(),
    );
    expect(petit.contributions[0].contribution).toBeCloseTo(gros.contributions[0].contribution * (100000 / 500000), 1);
    expect(inconnu.contributions[0].contribution).toBeCloseTo(gros.contributions[0].contribution * 0.6, 1);
  });

  it("un CPV hors cible est amorti, un marché sans CPV ni métier induit aussi", () => {
    const btp = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "45233140-2" } })],
      ctx(),
    );
    const info = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, cpv: "72000000-5" } })],
      ctx(),
    );
    const intellectuel = computeSismo(
      [signal({ type: "MARCHE_ATTRIBUE", payload: { montant: 500000, acheteurNom: "Ville" } })],
      ctx(),
    );
    expect(info.contributions[0].contribution).toBeCloseTo(
      btp.contributions[0].contribution * w["sismo.marche.cpv_hors_cible"],
      2,
    );
    expect(intellectuel.contributions[0].contribution).toBeCloseTo(
      btp.contributions[0].contribution * w["sismo.marche.cpv_hors_cible"],
      2,
    );
  });

  it("multipostes et réactualisation sont proportionnels", () => {
    const deux = computeSismo([signal({ type: "OFFRE_MULTIPOSTES", payload: { rome: "F1703", nombrePostes: 2 } })], ctx());
    const dix = computeSismo([signal({ type: "OFFRE_MULTIPOSTES", payload: { rome: "F1703", nombrePostes: 10 } })], ctx());
    expect(dix.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_MULTIPOSTES"], 1);
    expect(deux.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_MULTIPOSTES"] * (2 / w["sismo.postes.ref"]), 1);
    const reactu = computeSismo(
      [signal({ type: "OFFRE_REACTUALISEE", payload: { rome: "F1703", nbActualisations: 3 } })],
      ctx(),
    );
    expect(reactu.contributions[0].contribution).toBeCloseTo(w["sismo.poids.OFFRE_REACTUALISEE"], 1);
  });
});

describe("corroboration", () => {
  it("deux familles de sources valent plus que deux signaux d'une même famille", () => {
    const memeFamille = computeSismo(
      [
        signal({ id: "a", type: "OFFRE_DIRECTE", payload: { rome: "F1703" } }),
        signal({ id: "b", type: "OFFRE_DIRECTE", payload: { rome: "F1703" } }),
      ],
      ctx(),
    );
    const deuxFamilles = computeSismo(
      [
        signal({ id: "a", type: "OFFRE_DIRECTE", payload: { rome: "F1703" } }),
        signal({ id: "c", type: "ACCORD_SURCHARGE", payload: { themesFr: "heures supplémentaires" } }),
      ],
      ctx(),
    );
    // poids bruts proches (12 + 12 vs 12 + 14) mais la corroboration bonifie la seconde
    expect(deuxFamilles.sommeBrute).toBeGreaterThan(memeFamille.sommeBrute * 1.15);
    expect(deuxFamilles.components.some((c) => c.key === "corroboration")).toBe(true);
    expect(memeFamille.components.some((c) => c.key === "corroboration")).toBe(false);
  });

  it("une famille bavarde sature : 20 offres ne valent pas 20 × une offre", () => {
    const une = computeSismo([signal({ type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })], ctx());
    const vingt = computeSismo(
      Array.from({ length: 20 }, (_, i) => signal({ id: `o${i}`, type: "OFFRE_DIRECTE", payload: { rome: "F1703" } })),
      ctx(),
    );
    expect(vingt.sommeBrute).toBeLessThan(une.sommeBrute * 20 * 0.3);
    expect(vingt.sommeBrute).toBeLessThanOrEqual(w["sismo.famille.cap"]);
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

  it("un accord de restructuration ne se fait pas saturer ni bonifier", () => {
    const r = computeSismo(
      [
        signal({ id: "a", type: "OFFRE_DIRECTE", payload: { rome: "F1703" } }),
        signal({ id: "b", type: "ACCORD_RESTRUCTURATION", payload: { themesFr: "PSE" } }),
      ],
      ctx(),
    );
    expect(r.sommeBrute).toBeLessThan(0);
    expect(r.components.some((c) => c.key === "corroboration")).toBe(false);
  });
});

describe("signaux de bassin", () => {
  it("MISSION_CONCURRENT et AO_OUVERT ne scorent pas l'entreprise (poids 0)", () => {
    const r = computeSismo(
      [
        signal({ id: "a", type: "MISSION_CONCURRENT", payload: { rome: "F1703" } }),
        signal({ id: "b", type: "AO_OUVERT", payload: { objet: "voirie" } }),
      ],
      ctx(),
    );
    expect(r.contributions).toHaveLength(0);
    expect(r.score).toBe(0);
  });
});

describe("dédoublonnage des marchés (BOAMP puis DECP)", () => {
  const marche = (id: string, jours: number, objet: string, montant: number | null) =>
    signal({ id, type: "MARCHE_ATTRIBUE", occurredAt: joursAvant(jours), payload: { objet, montant, cpv: "45233140-2" } });

  it("le même marché republié par une seconde source ne compte qu'une fois", () => {
    const avisBoamp = marche("boamp", 20, "Accord-cadre à bons de commande - Prestations de voirie", null);
    const avisDecp = marche("decp", 44, "Accord-cadre à bons de commande — prestations de voirie", 940000);
    const decpSeul = computeSismo([avisDecp], ctx());
    const double = computeSismo([avisBoamp, avisDecp], ctx());
    // Deux marchés RÉELLEMENT distincts, pour situer ce que vaudrait un double comptage
    const deuxChantiers = computeSismo(
      [marche("x", 20, "Réfection de la voirie communale du bourg", 940000), avisDecp],
      ctx(),
    );

    // Le plus fort (celui qui porte le montant) est gardé, l'autre est annulé
    const gardes = double.contributions.filter((c) => c.contribution > 0);
    expect(gardes).toHaveLength(1);
    expect(gardes[0].id).toBe("decp");
    expect(double.contributions.find((c) => c.id === "boamp")!.contribution).toBe(0);
    // Le doublon ne pèse ni plus ni moins que le marché seul…
    expect(double.sommeBrute).toBeCloseTo(decpSeul.sommeBrute, 5);
    // …et strictement moins que deux chantiers différents
    expect(deuxChantiers.sommeBrute).toBeGreaterThan(double.sommeBrute);
  });

  it("deux chantiers réellement distincts comptent tous les deux", () => {
    const r = computeSismo(
      [
        marche("a", 20, "Réfection de la voirie communale du bourg", 480000),
        marche("b", 30, "Construction d'un groupe scolaire", 1200000),
      ],
      ctx(),
    );
    expect(r.contributions.filter((c) => c.contribution > 0)).toHaveLength(2);
  });

  it("deux marchés éloignés dans le temps comptent tous les deux, même objet", () => {
    const r = computeSismo(
      [
        marche("a", 10, "Entretien des espaces verts de la commune", 100000),
        marche("b", 300, "Entretien des espaces verts de la commune", 100000),
      ],
      ctx(),
    );
    expect(r.contributions.filter((c) => c.contribution > 0)).toHaveLength(2);
  });

  it("sans objet publié, on ne fusionne pas — le doute profite au signal", () => {
    const r = computeSismo(
      [
        signal({ id: "a", type: "MARCHE_ATTRIBUE", occurredAt: joursAvant(20), romes: ["F1702"], payload: { montant: 200000 } }),
        signal({ id: "b", type: "MARCHE_ATTRIBUE", occurredAt: joursAvant(30), romes: ["F1702"], payload: { montant: 200000 } }),
      ],
      ctx(),
    );
    expect(r.contributions.filter((c) => c.contribution > 0)).toHaveLength(2);
  });
});
