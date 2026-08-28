import { describe, expect, it } from "vitest";
import { buildRaison, dateFr, metier, montantFr } from "../raison";
import type { SignalContribution, SignalScoringInput } from "../types";

describe("formatage", () => {
  it("montants en k€ et M€", () => {
    expect(montantFr(480000)).toBe("480 k€");
    expect(montantFr(1200000)).toBe("1,2 M€");
    expect(montantFr(45000)).toBe("45 k€");
  });

  it("dates en français", () => {
    expect(dateFr("2026-08-12T10:00:00Z")).toBe("12 août");
    expect(dateFr("2026-02-01T10:00:00Z")).toBe("1er février");
  });

  it("métier extrait de l'intitulé", () => {
    expect(metier("Cariste CACES 3 (H/F)")).toBe("cariste CACES 3");
    expect(metier("Maçon VRD (F/H)")).toBe("maçon VRD");
  });
});

describe("raison d'appeler", () => {
  const signaux: SignalScoringInput[] = [
    {
      id: "s1",
      type: "OFFRE_REPUBLIEE",
      occurredAt: "2026-08-20T08:00:00Z",
      confidence: 0.95,
      payload: {
        intitule: "Cariste CACES 3 (H/F)",
        rome: "N1101",
        nbRepublications: 3,
        premierePublication: "2026-08-12T08:00:00Z",
      },
    },
    {
      id: "s2",
      type: "MARCHE_ATTRIBUE",
      occurredAt: "2026-08-03T08:00:00Z",
      confidence: 1,
      payload: { objet: "Voirie", montant: 480000, acheteur: "Métropole AMP", cpv: "45233140-2" },
    },
  ];
  const contributions: SignalContribution[] = [
    { id: "s1", type: "OFFRE_REPUBLIEE", occurredAt: "2026-08-20T08:00:00Z", contribution: 14 },
    { id: "s2", type: "MARCHE_ATTRIBUE", occurredAt: "2026-08-03T08:00:00Z", contribution: 19 },
  ];

  it("assemble l'exemple attendu du brief", () => {
    const { raisonFr } = buildRaison(signaux, contributions, { tauxRecoursSecteur: 8.2 });
    expect(raisonFr).toBe(
      "A décroché un marché public de 480 k€ le 3 août (Voirie), et a republié 3 fois la même offre de cariste CACES 3 depuis le 12 août. Secteur à fort recours à l'intérim.",
    );
  });

  it("omet la mention secteur quand le taux de recours est faible", () => {
    const { raisonFr } = buildRaison(signaux, contributions, { tauxRecoursSecteur: 1.2 });
    expect(raisonFr).not.toContain("Secteur à fort recours");
  });

  it("signale une procédure collective en fin de raison", () => {
    const risque: SignalScoringInput = {
      id: "s3",
      type: "BODACC_RISQUE",
      occurredAt: "2026-07-28T08:00:00Z",
      confidence: 1,
      payload: { procedure: "redressement judiciaire" },
    };
    const { raisonFr } = buildRaison(
      [...signaux, risque],
      [
        ...contributions,
        { id: "s3", type: "BODACC_RISQUE", occurredAt: "2026-07-28T08:00:00Z", contribution: -35 },
      ],
      { tauxRecoursSecteur: 8.2 },
    );
    expect(raisonFr).toContain("Attention : redressement judiciaire en cours depuis le 28 juillet.");
  });

  it("agrège plusieurs offres directes en une clause", () => {
    const offres: SignalScoringInput[] = [1, 2, 3].map((i) => ({
      id: `o${i}`,
      type: "OFFRE_DIRECTE",
      occurredAt: `2026-08-${10 + i}T08:00:00Z`,
      confidence: 0.9,
      payload: { intitule: "Maçon (H/F)", rome: "F1703", typeContrat: "CDI" },
    }));
    const { raisonFr } = buildRaison(
      offres,
      offres.map((o) => ({ id: o.id, type: o.type, occurredAt: o.occurredAt, contribution: 8 })),
      { tauxRecoursSecteur: 8.2 },
    );
    expect(raisonFr).toContain("A publié 3 offres en direct depuis le 11 août");
  });

  it("aucun signal → message nurturing", () => {
    const { raisonFr } = buildRaison([], [], { tauxRecoursSecteur: 8 });
    expect(raisonFr).toBe("Bon profil structurel, aucun déclencheur récent.");
  });
});

describe("proposition", () => {
  it("propose des métiers, une fenêtre et un lieu", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    const signaux: SignalScoringInput[] = [
      {
        id: "m",
        type: "MARCHE_ATTRIBUE",
        occurredAt: "2026-08-20T08:00:00Z",
        confidence: 1,
        payload: { objet: "Aménagement de l'entrée Nord", montant: null, acheteurNom: "Commune de Saint-Pourçain" },
        romes: ["F1702", "F1302"],
      },
    ];
    const contributions: SignalContribution[] = [
      { id: "m", type: "MARCHE_ATTRIBUE", occurredAt: "2026-08-20T08:00:00Z", contribution: 10 },
    ];
    const { raisonFr, propositionFr } = buildRaison(signaux, contributions, {
      tauxRecoursSecteur: 9,
      romesInduits: ["F1702", "F1302"],
      fenetre: { debut: "2026-10-15T00:00:00Z", fin: "2026-11-15T00:00:00Z" },
      lieuFr: "Saint-Pourçain-sur-Sioule",
      distanceKm: 12.4,
      now,
    });
    expect(raisonFr).toContain("A décroché un marché public pour Commune de Saint-Pourçain le 20 août (Aménagement de l'entrée Nord)");
    expect(propositionFr).toContain("Proposer : construction de routes et voies, conduite d'engins de chantier");
    expect(propositionFr).toContain("Appeler entre le 15 octobre et le 15 novembre");
    expect(propositionFr).toContain("Besoin à Saint-Pourçain-sur-Sioule (12 km)");
  });

  it("n'invente rien quand il n'y a ni métier ni fenêtre", () => {
    const { propositionFr } = buildRaison([], [], { tauxRecoursSecteur: 8 });
    expect(propositionFr).toBeNull();
  });
});
