import { describe, expect, it } from "vitest";
import {
  communeDepuisLibelle,
  dureeContratJours,
  estAgenceInterim,
  francetravailAdapter,
} from "../adapters/francetravail";

/**
 * Ces tests figent trois pièges constatés sur l'API réelle le 27/08/2026.
 * Ils protègent contre une régression silencieuse du parsing.
 */

describe("durée du contrat", () => {
  it("se lit dans typeContratLibelle, pas dans le temps de travail", () => {
    expect(dureeContratJours("CDD - 12 Mois")).toBe(360);
    expect(dureeContratJours("CDD - 29 Jour(s)")).toBe(29);
    expect(dureeContratJours("Intérim - 14 Jour(s)")).toBe(14);
    expect(dureeContratJours("Intérim - 3 Mois")).toBe(90);
  });

  it("rend null quand aucune durée n'est exprimée", () => {
    expect(dureeContratJours("CDI")).toBeNull();
    expect(dureeContratJours("Reprise d'entreprise")).toBeNull();
    expect(dureeContratJours(null)).toBeNull();
  });

  it("ne se laisse pas piéger par le temps de travail hebdomadaire", () => {
    // « 35H/semaine » vit dans dureeTravailLibelle : ce n'est PAS une durée de contrat.
    expect(dureeContratJours("35H/semaine")).toBeNull();
  });
});

describe("commune du lieu de travail", () => {
  it("retire le préfixe départemental", () => {
    expect(communeDepuisLibelle("03 - Gannat")).toBe("Gannat");
    expect(communeDepuisLibelle("03 - Saint-Pourçain-sur-Sioule")).toBe("Saint-Pourçain-sur-Sioule");
  });

  it("tolère un libellé sans préfixe ou absent", () => {
    expect(communeDepuisLibelle("Vichy")).toBe("Vichy");
    expect(communeDepuisLibelle(null)).toBeNull();
    expect(communeDepuisLibelle("")).toBeNull();
  });
});

describe("détection d'une agence d'intérim", () => {
  it("s'appuie d'abord sur le NAF de l'annonceur", () => {
    // Division 78 : activités liées à l'emploi
    expect(estAgenceInterim("78.20Z", "CDI", "UNE ENSEIGNE INCONNUE")).toBe(true);
    expect(estAgenceInterim("43.99C", "CDI", "MACONNERIE DURAND")).toBe(false);
  });

  it("retient aussi le contrat de mission", () => {
    expect(estAgenceInterim("43.99C", "MIS", "MACONNERIE DURAND")).toBe(true);
  });

  it("rattrape les enseignes connues en dernier recours", () => {
    expect(estAgenceInterim(null, "CDD", "ADECCO BTP VICHY")).toBe(true);
    expect(estAgenceInterim(null, "CDD", "BOULANGERIE MARTIN")).toBe(false);
  });
});

describe("normalisation d'une offre", () => {
  const [offreEntreprise, , offreAgence] = francetravailAdapter.fixture();

  it("ne stocke aucune donnée de personne physique", () => {
    // L'API expose un objet `contact` (nom, téléphone, courriel) : il ne doit
    // apparaître ni dans le schéma, ni dans l'enregistrement normalisé.
    const [record] = francetravailAdapter.normalize({
      ...offreEntreprise,
      // champ volontairement injecté : il doit être ignoré par le schéma
      ...({ contact: { nom: "M. UNTEL", courriel: "untel@example.fr" } } as object),
    });
    const serialise = JSON.stringify(record);
    expect(serialise).not.toContain("UNTEL");
    expect(serialise).not.toContain("example.fr");
    expect(record.kind).toBe("offre");
  });

  it("distingue une offre d'entreprise d'une mission d'agence", () => {
    const [directe] = francetravailAdapter.normalize(offreEntreprise);
    const [mission] = francetravailAdapter.normalize(offreAgence);
    if (directe.kind !== "offre" || mission.kind !== "offre") throw new Error("type inattendu");
    expect(directe.offre.parAgenceInterim).toBe(0);
    expect(mission.offre.parAgenceInterim).toBe(1);
  });

  it("n'invente pas de SIRET : l'API n'en fournit jamais", () => {
    for (const brut of francetravailAdapter.fixture()) {
      const [record] = francetravailAdapter.normalize(brut);
      if (record.kind !== "offre") throw new Error("type inattendu");
      expect(record.offre.siret).toBeNull();
    }
  });
});
