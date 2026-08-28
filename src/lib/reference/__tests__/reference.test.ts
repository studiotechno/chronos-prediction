import { describe, expect, it } from "vitest";
import { normaliserIdcc, tauxRecoursIdcc } from "../idcc";
import { facteurSaison, sectionNaf } from "../saison";
import { famillesFapDeRome, lectureBmo } from "../bmo";
import { romesDeCpv, romesDeLibelleMarche, romesDePermis } from "../metiers";

describe("IDCC", () => {
  it("normalise les codes (zéros, décimales)", () => {
    expect(normaliserIdcc("0016")).toBe("16");
    expect(normaliserIdcc("1597.0")).toBe("15970");
    expect(normaliserIdcc("3043")).toBe("3043");
  });

  it("retient la convention la plus intense d'une entreprise du bâtiment", () => {
    const r = tauxRecoursIdcc(["2420", "2609", "1597"]);
    expect(r?.idcc).toBe("1597");
    expect(r!.tauxPct).toBeGreaterThan(8);
  });

  it("signale les agences d'intérim comme exclues", () => {
    expect(tauxRecoursIdcc(["2378"])?.niveauSource).toBe("exclu");
  });

  it("rend null pour une convention inconnue", () => {
    expect(tauxRecoursIdcc(["9999"])).toBeNull();
    expect(tauxRecoursIdcc([])).toBeNull();
  });
});

describe("saisonnalité", () => {
  it("classe les divisions NAF par section", () => {
    expect(sectionNaf("43.99C")).toBe("F");
    expect(sectionNaf("10.71C")).toBe("C");
    expect(sectionNaf("49.41A")).toBe("H");
    expect(sectionNaf("56.10A")).toBe("I");
    expect(sectionNaf("01.11Z")).toBe("A");
  });

  it("le bâtiment est en pointe en juin et en creux en décembre", () => {
    expect(facteurSaison("43.99C", new Date("2026-06-15T00:00:00Z"))).toBeGreaterThan(1);
    expect(facteurSaison("43.99C", new Date("2026-12-15T00:00:00Z"))).toBeLessThan(1);
  });
});

describe("BMO", () => {
  it("pont ROME → familles BMO", () => {
    expect(famillesFapDeRome("F1703")).toEqual(["O"]);
    expect(famillesFapDeRome("H2913")).toEqual(["I"]);
    expect(famillesFapDeRome("K2204")).toEqual(["V"]);
    expect(famillesFapDeRome("K1302")).toEqual(["S"]);
    expect(famillesFapDeRome("N1101")).toEqual(["Z"]);
  });

  it("lit l'Allier pour les ouvriers du bâtiment", () => {
    const l = lectureBmo("03", ["F1703"]);
    expect(l).not.toBeNull();
    expect(l!.projets).toBeGreaterThan(100);
    expect(l!.partDifficile).toBeGreaterThan(0.5);
    expect(l!.partDifficile).toBeLessThanOrEqual(1);
  });

  it("rend null sans département ou sans métier", () => {
    expect(lectureBmo(null, ["F1703"])).toBeNull();
    expect(lectureBmo("03", [])).toBeNull();
  });
});

describe("métiers induits", () => {
  it("reconnaît la voirie, le nettoyage, les espaces verts", () => {
    expect(romesDeLibelleMarche(["Voirie et réseaux divers"])).toContain("F1702");
    expect(romesDeLibelleMarche(["Nettoyage de locaux"])).toEqual(["K2204"]);
    expect(romesDeLibelleMarche(["Entretien des espaces verts"])).toEqual(["A1203"]);
    expect(romesDeLibelleMarche(["Maîtrise d'oeuvre", "Assurance"])).toEqual([]);
  });

  it("lit le CPV", () => {
    expect(romesDeCpv("45233140-2")).toContain("F1702");
    expect(romesDeCpv("90911200-8")).toEqual(["K2204"]);
    expect(romesDeCpv("72000000-5")).toEqual([]);
  });

  it("un permis d'entrepôt : chantier puis logistique", () => {
    const r = romesDePermis("Entrepôt");
    expect(r.chantier).toContain("F1703");
    expect(r.exploitation).toContain("N1103");
  });
});

describe("métiers induits — marchés sans ouvriers", () => {
  it("écarte les prestations intellectuelles et de contrôle, même quand elles citent un bâtiment", () => {
    // Cas réels observés sur le BOAMP de l'Allier
    expect(romesDeLibelleMarche(["Groupement de commande pour les vérifications périodiques obligatoires des bâtiments"])).toEqual([]);
    expect(romesDeLibelleMarche(["Marché de maîtrise d'oeuvre pour la réhabilitation de l'établissement thermal"])).toEqual([]);
    expect(romesDeLibelleMarche(["Mission de maîtrise d'oeuvre pour la restauration de l'Eglise"])).toEqual([]);
    expect(romesDeLibelleMarche(["Souscription de contrats d'assurance"])).toEqual([]);
    expect(romesDeLibelleMarche(["Refonte du site internet du Département"])).toEqual([]);
    expect(romesDeLibelleMarche(["Fourniture de denrées alimentaires"])).toEqual([]);
  });

  it("garde les vrais travaux", () => {
    expect(romesDeLibelleMarche(["REHABILITATION DU PAVILLON DE LA SOURCE DE L'HOPITAL"])).toContain("F1703");
    expect(romesDeLibelleMarche(["Travaux d'aménagement de l'entrée Nord de l'agglomération"])).toContain("F1702");
    expect(romesDeLibelleMarche(["Nettoyage des locaux de divers sites de la ville"])).toEqual(["K2204"]);
  });

  it("distingue le transport de voyageurs du transport de marchandises", () => {
    expect(romesDeLibelleMarche(["AT03 Transport scolaire 19 lots"])).toEqual(["N4103"]);
    expect(romesDeLibelleMarche(["Marché de transport et livraison de colis"])).toContain("N4101");
  });
});

describe("métiers induits — pièges d'homonymie observés sur le BOAMP", () => {
  it("« restauration » d'un monument n'est pas de la restauration collective", () => {
    expect(romesDeLibelleMarche(["Restauration de l'Église Notre-Dame"])).toEqual([]);
    expect(romesDeLibelleMarche(["Marché de restauration collective des écoles"])).toContain("G1602");
  });

  it("« bâtiment » seul ne fait pas un marché de gros œuvre", () => {
    // Un marché de chauffagiste, pas de maçon
    expect(romesDeLibelleMarche(["Entretien des installations de chauffage et de climatisation des bâtiments communaux"])).toEqual(["F1603"]);
    expect(romesDeLibelleMarche(["Travaux de bâtiment tous corps d'état"])).toContain("F1703");
  });

  it("« aménagement » ne déclenche pas le nettoyage (le mot contient « ménage »)", () => {
    expect(romesDeLibelleMarche(["Travaux d'aménagement de l'entrée Nord de l'agglomération"])).not.toContain("K2204");
  });
});

describe("métiers induits — libellés machine du BOAMP", () => {
  it("reconnaît un objet nommé sans espaces", () => {
    expect(romesDeLibelleMarche(["AT03_TransportScolaire_19Lots_2026"])).toEqual(["N4103"]);
  });
});

describe("CPV transport", () => {
  it("distingue le transport de personnes du fret", () => {
    expect(romesDeCpv("60130000-8")).toEqual(["N4103"]); // transport routier de passagers
    expect(romesDeCpv("60112000-6")).toEqual(["N4103"]); // transport public routier
    expect(romesDeCpv("60181000-0")).toEqual(["N4101", "N4105"]); // camions avec chauffeur
    expect(romesDeCpv("60240000-2")).toEqual(["N4101", "N4105"]); // transport de marchandises
  });
});

describe("métiers induits — transport de personnes", () => {
  it("navette et transport à la demande sont du transport de voyageurs", () => {
    expect(romesDeLibelleMarche(["AT03_TAD_10lots_2026"])).toEqual(["N4103"]);
    expect(romesDeLibelleMarche(["AT03_Navette_Le PAL_2Lots_2026"])).toEqual(["N4103"]);
    expect(romesDeLibelleMarche(["Marché de transport et livraison de colis"])).toEqual(["N4101", "N4105"]);
  });
});
