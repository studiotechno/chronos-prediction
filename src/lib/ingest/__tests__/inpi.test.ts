import { describe, expect, it } from "vitest";
import { inpiAdapter, lireExercices, LOT } from "../adapters/inpi";

describe("INPI — exercices", () => {
  it("retient les deux derniers exercices et dérive une tendance", () => {
    const [entreprise] = inpiAdapter.fixture();
    const f = lireExercices(entreprise.exercices);
    expect(f).toEqual({ caAnnee: 2025, ca: 7300000, caPrecedent: 6200000, resultatNet: 250000, resultatNetPrecedent: 210000 });
    const records = inpiAdapter.normalize(entreprise);
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe("finances");
    if (records[0].kind === "finances") expect(records[0].siren).toBe("900900001");
  });

  it("préfère les comptes sociaux aux comptes consolidés d'une même année, et ignore un exercice non public", () => {
    const f = lireExercices([
      { siren: "1", date_cloture_exercice: "2024-12-31", chiffre_d_affaires: 900000000, resultat_net: 1, type_bilan: "K", confidentiality: "Public" },
      { siren: "1", date_cloture_exercice: "2024-12-31", chiffre_d_affaires: 20000000, resultat_net: 2, type_bilan: "C", confidentiality: "Public" },
      { siren: "1", date_cloture_exercice: "2023-12-31", chiffre_d_affaires: 18000000, resultat_net: 3, type_bilan: "C", confidentiality: "Public" },
      { siren: "1", date_cloture_exercice: "2025-12-31", chiffre_d_affaires: 50000000, resultat_net: 4, type_bilan: "C", confidentiality: "Confidentiel" },
    ]);
    expect(f.caAnnee).toBe(2024);
    expect(f.ca).toBe(20000000);
    expect(f.caPrecedent).toBe(18000000);
  });

  it("une année isolée n'a pas d'exercice précédent ; un CA à 0 vaut inconnu", () => {
    const f = lireExercices([
      { siren: "1", date_cloture_exercice: "2024-06-30", chiffre_d_affaires: 0, resultat_net: -5, type_bilan: "S" },
      { siren: "1", date_cloture_exercice: "2022-06-30", chiffre_d_affaires: 100, resultat_net: 1, type_bilan: "S" },
    ]);
    expect(f.caAnnee).toBe(2024);
    expect(f.ca).toBeNull();
    expect(f.caPrecedent).toBeNull();
    expect(f.resultatNet).toBe(-5);
    expect(lireExercices([]).caAnnee).toBeNull();
  });

  it("interroge par lots bornés", () => {
    expect(LOT).toBeGreaterThan(0);
    expect(LOT).toBeLessThanOrEqual(50);
  });
});
