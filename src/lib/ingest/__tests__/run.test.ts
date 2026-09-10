import { describe, expect, it } from "vitest";
import { estOuvertureRecente } from "../run";

const NOW = new Date("2026-09-10T12:00:00Z");

describe("ouverture d'établissement (ETAB_NOUVEAU)", () => {
  it("une entreprise établie qui ouvre un site depuis moins de six mois", () => {
    expect(
      estOuvertureRecente({ dateDebutActivite: "2026-07-01", etatAdministratif: "A" }, { dateCreation: "2012-03-15" }, NOW),
    ).toBe(true);
  });

  it("pas une entreprise qui vient de naître, ni un site fermé, ni une ouverture ancienne", () => {
    expect(
      estOuvertureRecente({ dateDebutActivite: "2026-07-01", etatAdministratif: "A" }, { dateCreation: "2026-06-20" }, NOW),
    ).toBe(false);
    expect(
      estOuvertureRecente({ dateDebutActivite: "2026-07-01", etatAdministratif: "F" }, { dateCreation: "2012-03-15" }, NOW),
    ).toBe(false);
    expect(
      estOuvertureRecente({ dateDebutActivite: "2025-01-01", etatAdministratif: "A" }, { dateCreation: "2012-03-15" }, NOW),
    ).toBe(false);
    expect(estOuvertureRecente({ dateDebutActivite: null, etatAdministratif: "A" }, { dateCreation: "2012-03-15" }, NOW)).toBe(false);
  });
});
