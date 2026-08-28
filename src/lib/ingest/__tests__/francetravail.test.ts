import { describe, expect, it } from "vitest";
import {
  caviarder,
  communeDepuisLibelle,
  dureeContratJours,
  estAgenceInterim,
  francetravailAdapter,
  trancheCodeDepuisLibelle,
} from "../adapters/francetravail";

/**
 * Ces tests figent les pièges constatés sur l'API réelle (27 et 28/08/2026).
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

describe("tranche d'effectif de l'établissement employeur", () => {
  it("convertit le libellé publié par France Travail en code INSEE", () => {
    // Libellés relevés tels quels sur 150 offres réelles de l'Allier (28/08/2026)
    expect(trancheCodeDepuisLibelle("20 à 49 salariés")).toBe("12");
    expect(trancheCodeDepuisLibelle("1 ou 2 salariés")).toBe("01");
    expect(trancheCodeDepuisLibelle("3 à 5 salariés")).toBe("02");
    expect(trancheCodeDepuisLibelle("6 à 9 salariés")).toBe("03");
    expect(trancheCodeDepuisLibelle("10 à 19 salariés")).toBe("11");
    expect(trancheCodeDepuisLibelle("50 à 99 salariés")).toBe("21");
    expect(trancheCodeDepuisLibelle("100 à 199 salariés")).toBe("22");
    expect(trancheCodeDepuisLibelle("200 à 249 salariés")).toBe("31");
    expect(trancheCodeDepuisLibelle("250 à 499 salariés")).toBe("32");
    expect(trancheCodeDepuisLibelle("500 à 999 salariés")).toBe("41");
    expect(trancheCodeDepuisLibelle("1000 à 1999 salariés")).toBe("42");
    expect(trancheCodeDepuisLibelle("2000 à 4999 salariés")).toBe("51");
    expect(
      trancheCodeDepuisLibelle(
        "0 salarié (n'ayant pas d'effectif au 31/12 mais ayant employé des salariés au cours de l'année de référence)",
      ),
    ).toBe("00");
  });

  it("accepte un code déjà formé et rejette l'inconnu", () => {
    expect(trancheCodeDepuisLibelle("12")).toBe("12");
    expect(trancheCodeDepuisLibelle(null)).toBeNull();
    expect(trancheCodeDepuisLibelle("Non renseigné")).toBeNull();
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
  const [offreEntreprise, offreCdd, offreAgence] = francetravailAdapter.fixture();

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

  it("lit les champs V2 : postes, manque de candidats, actualisation, tranche, lieu géolocalisé", () => {
    const [record] = francetravailAdapter.normalize(offreEntreprise);
    if (record.kind !== "offre") throw new Error("type inattendu");
    expect(record.offre.nombrePostes).toBe(3);
    expect(record.offre.manqueCandidats).toBe(1);
    expect(record.offre.dateActualisation).toBe(offreEntreprise.dateActualisation);
    expect(record.offre.trancheEffectifEtab).toBe("12");
    expect(record.offre.codeInsee).toBe("03310");
    expect(record.offre.lat).toBe(46.127);
    expect(record.offre.lon).toBe(3.426);
    expect(record.offre.payload).toMatchObject({
      codeNAF: "43.99C",
      experienceExige: "D",
      qualificationCode: "5",
      secteurActivite: "43",
      natureContrat: "Contrat travail",
      alternance: false,
    });
  });

  it("met les absences à leur valeur neutre", () => {
    const [record] = francetravailAdapter.normalize({
      ...offreCdd,
      nombrePostes: null,
      offresManqueCandidats: null,
      trancheEffectifEtab: null,
      lieuTravail: { libelle: "03 - Moulins", codePostal: "03000", commune: null, latitude: null, longitude: null },
    });
    if (record.kind !== "offre") throw new Error("type inattendu");
    expect(record.offre.nombrePostes).toBeNull();
    expect(record.offre.manqueCandidats).toBe(0);
    expect(record.offre.trancheEffectifEtab).toBeNull();
    expect(record.offre.codeInsee).toBeNull();
    expect(record.offre.lat).toBeNull();
    expect(record.offre.lon).toBeNull();
  });
});

describe("caviardage des textes libres", () => {
  const [offreEntreprise] = francetravailAdapter.fixture();

  // Le corps d'une annonce échappe à la liste blanche de champs : c'est le seul
  // endroit où une coordonnée de personne physique peut entrer dans le système.
  it("retire courriels et téléphones sans casser le texte", () => {
    const texte = caviarder(
      "Envoyez votre CV à recrutement.jean@societe-exemple.fr ou appelez le 04 70 12 34 56. Poste à pourvoir.",
    );
    expect(texte).not.toContain("@");
    expect(texte).not.toContain("04 70 12 34 56");
    expect(texte).toContain("Poste à pourvoir.");
  });

  it("laisse intact un texte sans coordonnée, et rend null sur du vide", () => {
    expect(caviarder("Recherche cariste CACES 3, 35H/semaine.")).toBe(
      "Recherche cariste CACES 3, 35H/semaine.",
    );
    expect(caviarder(null)).toBeNull();
    expect(caviarder("   ")).toBeNull();
  });

  it("caviarde la description et la présentation de l'employeur à la normalisation", () => {
    const [record] = francetravailAdapter.normalize({
      ...offreEntreprise,
      description: "Poste de cariste. Contact : marie@exemple.fr",
      entreprise: { ...offreEntreprise.entreprise, description: "Nous joindre au 06 12 34 56 78" },
    });
    if (record.kind !== "offre") throw new Error("type inattendu");
    const payload = record.offre.payload as Record<string, unknown>;
    expect(payload.description).toBe("Poste de cariste. Contact : [courriel retiré]");
    expect(payload.entrepriseDescription).toBe("Nous joindre au [téléphone retiré]");
  });
});

describe("contenu de l'annonce", () => {
  const [offreEntreprise] = francetravailAdapter.fixture();

  it("reprend salaire, compétences et lien vers l'offre en liste blanche", () => {
    const [record] = francetravailAdapter.normalize({
      ...offreEntreprise,
      salaire: {
        libelle: "Mensuel de 1982.0 Euros à 2398.0 Euros sur 12 mois",
        listeComplements: [{ libelle: "Primes" }, { libelle: "Complémentaire santé" }],
      },
      competences: [
        { libelle: "Conduite de chariot élévateur", exigence: "E" },
        { libelle: "Gestion des stocks", exigence: "S" },
      ],
      permis: [{ libelle: "B - Véhicule léger", exigence: "E" }],
      origineOffre: { origine: "1", urlOrigine: "https://candidat.francetravail.fr/offres/recherche/detail/196ABCD" },
    });
    if (record.kind !== "offre") throw new Error("type inattendu");
    const payload = record.offre.payload as Record<string, unknown>;
    expect(payload.salaireLibelle).toBe("Mensuel de 1982.0 Euros à 2398.0 Euros sur 12 mois");
    expect(payload.salaireComplements).toEqual(["Primes", "Complémentaire santé"]);
    // L'exigence « E » est marquée, « S » reste nue : le commercial doit voir ce qui bloque.
    expect(payload.competences).toEqual(["Conduite de chariot élévateur (exigé)", "Gestion des stocks"]);
    expect(payload.permis).toEqual(["B - Véhicule léger (exigé)"]);
    expect(payload.urlOffre).toBe("https://candidat.francetravail.fr/offres/recherche/detail/196ABCD");
  });

  it("ne fabrique pas de tableau vide quand la source ne dit rien", () => {
    const [record] = francetravailAdapter.normalize(offreEntreprise);
    if (record.kind !== "offre") throw new Error("type inattendu");
    const payload = record.offre.payload as Record<string, unknown>;
    expect(payload.competences).toBeNull();
    expect(payload.salaireComplements).toBeNull();
  });
});
