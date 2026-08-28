import { describe, expect, it } from "vitest";
import { deriveSignaux, lieuDe, type OffreLike } from "../derive-offres";

const NOW = new Date("2026-08-28T12:00:00Z");
const SIRET = "90090000100019";

function joursAvant(n: number): string {
  return new Date(NOW.getTime() - n * 86400000).toISOString();
}

function offre(partial: Partial<OffreLike> & { id: string }): OffreLike {
  return {
    siret: SIRET,
    entrepriseNom: "DEMO BATIMENT BOURBONNAIS",
    intitule: "Maçon (H/F)",
    typeContrat: "CDI",
    dureeContratJours: null,
    rome: "F1703",
    codePostal: "03200",
    commune: "Vichy",
    codeInsee: "03310",
    lat: 46.127,
    lon: 3.426,
    parAgenceInterim: 0,
    datePublication: joursAvant(10),
    dateActualisation: joursAvant(10),
    nbActualisations: 0,
    nombrePostes: 1,
    manqueCandidats: 0,
    trancheEffectifEtab: null,
    closedAt: null,
    payload: { codeNAF: "43.99C" },
    ...partial,
  };
}

function types(signaux: ReturnType<typeof deriveSignaux>): string[] {
  return signaux.map((s) => s.type).sort();
}

describe("lieu du besoin", () => {
  it("est le lieu de travail géolocalisé de l'offre", () => {
    expect(lieuDe(offre({ id: "a" }))).toEqual({ lat: 46.127, lon: 3.426, libelle: "Vichy" });
  });

  it("est absent sans coordonnées, jamais NaN", () => {
    expect(lieuDe(offre({ id: "a", lat: null, lon: null }))).toBeNull();
    expect(lieuDe(offre({ id: "a", lat: Number.NaN, lon: 3.4 }))).toBeNull();
  });
});

describe("signaux d'offres V2", () => {
  it("une offre directe ordinaire ne produit qu'OFFRE_DIRECTE, avec lieu et ROME", () => {
    const signaux = deriveSignaux([offre({ id: "a" })], NOW);
    expect(types(signaux)).toEqual(["OFFRE_DIRECTE"]);
    expect(signaux[0].lieu).toEqual({ lat: 46.127, lon: 3.426, libelle: "Vichy" });
    expect(signaux[0].romes).toEqual(["F1703"]);
    expect(signaux[0].siret).toBe(SIRET);
    expect(signaux[0].rawRef).toBe("directe-a");
  });

  it("OFFRE_MANQUE_CANDIDATS quand France Travail signale le manque de candidats", () => {
    const signaux = deriveSignaux([offre({ id: "a", manqueCandidats: 1 })], NOW);
    expect(types(signaux)).toEqual(["OFFRE_DIRECTE", "OFFRE_MANQUE_CANDIDATS"]);
    const s = signaux.find((x) => x.type === "OFFRE_MANQUE_CANDIDATS")!;
    expect(s.rawRef).toBe("manque-a");
    expect(s.payload).toMatchObject({ intitule: "Maçon (H/F)", rome: "F1703", typeContrat: "CDI" });
  });

  it("OFFRE_MULTIPOSTES à partir de deux postes", () => {
    expect(types(deriveSignaux([offre({ id: "a", nombrePostes: 1 })], NOW))).toEqual(["OFFRE_DIRECTE"]);
    const signaux = deriveSignaux([offre({ id: "a", nombrePostes: 4 })], NOW);
    expect(types(signaux)).toEqual(["OFFRE_DIRECTE", "OFFRE_MULTIPOSTES"]);
    const s = signaux.find((x) => x.type === "OFFRE_MULTIPOSTES")!;
    expect(s.payload).toMatchObject({ nombrePostes: 4 });
    expect(s.rawRef).toBe("multi-a");
  });

  it("OFFRE_REACTUALISEE à partir de deux actualisations, datée de l'actualisation, une par palier", () => {
    expect(types(deriveSignaux([offre({ id: "a", nbActualisations: 1 })], NOW))).toEqual(["OFFRE_DIRECTE"]);
    const signaux = deriveSignaux(
      [offre({ id: "a", nbActualisations: 3, datePublication: joursAvant(40), dateActualisation: joursAvant(2) })],
      NOW,
    );
    const s = signaux.find((x) => x.type === "OFFRE_REACTUALISEE")!;
    expect(s).toBeDefined();
    expect(s.occurredAt).toBe(joursAvant(2));
    expect(s.rawRef).toBe("reactu-a-3");
    expect(s.payload).toMatchObject({ nbActualisations: 3, premierePublication: joursAvant(40) });
  });

  it("ignore les offres de plus de 90 jours et celles sans SIRET", () => {
    const signaux = deriveSignaux(
      [
        offre({ id: "vieille", datePublication: joursAvant(120), manqueCandidats: 1 }),
        offre({ id: "orpheline", siret: null, manqueCandidats: 1 }),
      ],
      NOW,
    );
    expect(signaux).toHaveLength(0);
  });

  it("une mission d'agence ne score personne mais porte lieu et ROME (couverture)", () => {
    const signaux = deriveSignaux(
      [offre({ id: "m", parAgenceInterim: 1, entrepriseNom: "ADECCO", typeContrat: "MIS", manqueCandidats: 1, nombrePostes: 5 })],
      NOW,
    );
    expect(types(signaux)).toEqual(["MISSION_CONCURRENT"]);
    expect(signaux[0].siret).toBeNull();
    expect(signaux[0].lieu?.libelle).toBe("Vichy");
    expect(signaux[0].romes).toEqual(["F1703"]);
  });
});

describe("dérivées historiques inchangées", () => {
  it("OFFRE_REPUBLIEE exige une occurrence close avant la suivante", () => {
    const sansCloture = deriveSignaux(
      [offre({ id: "a", datePublication: joursAvant(30) }), offre({ id: "b", datePublication: joursAvant(5) })],
      NOW,
    );
    expect(types(sansCloture)).toEqual(["OFFRE_DIRECTE", "OFFRE_DIRECTE"]);

    const avecCloture = deriveSignaux(
      [
        offre({ id: "a", datePublication: joursAvant(30), closedAt: joursAvant(15) }),
        offre({ id: "b", datePublication: joursAvant(5) }),
      ],
      NOW,
    );
    const repub = avecCloture.find((s) => s.type === "OFFRE_REPUBLIEE")!;
    expect(repub).toBeDefined();
    expect(repub.payload).toMatchObject({ nbRepublications: 2 });
    expect(repub.occurredAt).toBe(joursAvant(5));
    expect(repub.romes).toEqual(["F1703"]);
  });

  it("CDD_COURT_REPETE à partir de trois CDD courts sur 60 jours, ROME agrégés", () => {
    const signaux = deriveSignaux(
      [
        offre({ id: "a", typeContrat: "CDD", dureeContratJours: 30, datePublication: joursAvant(50), rome: "N1103" }),
        offre({ id: "b", typeContrat: "CDD", dureeContratJours: 60, datePublication: joursAvant(20), rome: "N1101" }),
        offre({ id: "c", typeContrat: "CDD", dureeContratJours: 15, datePublication: joursAvant(3), rome: "N1103" }),
      ],
      NOW,
    );
    const cdd = signaux.find((s) => s.type === "CDD_COURT_REPETE")!;
    expect(cdd).toBeDefined();
    expect(cdd.payload).toMatchObject({ nbCdd: 3, fenetreJours: 60 });
    expect(cdd.romes).toEqual(["N1103", "N1101"]);
    expect(cdd.lieu?.libelle).toBe("Vichy");
  });

  it("OFFRE_VELOCITE quand les 14 derniers jours dépassent la baseline", () => {
    const offres = [1, 2, 3, 4].map((i) => offre({ id: `r${i}`, datePublication: joursAvant(i) }));
    const signaux = deriveSignaux(offres, NOW);
    const velo = signaux.find((s) => s.type === "OFFRE_VELOCITE")!;
    expect(velo).toBeDefined();
    expect(velo.payload).toMatchObject({ nbOffres14j: 4 });
    expect(velo.romes).toEqual(["F1703"]);
  });
});
