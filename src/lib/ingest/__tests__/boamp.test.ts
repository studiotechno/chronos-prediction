import { describe, expect, it } from "vitest";
import { boampAdapter, boampRecordSchema, departementBoamp, titulairesDe } from "../adapters/boamp";

describe("BOAMP — département", () => {
  it("retire le zéro initial, tel que le BOAMP stocke le code", () => {
    expect(departementBoamp("03")).toBe("3");
    expect(departementBoamp("63")).toBe("63");
    expect(departementBoamp("2A")).toBe("2A");
    expect(departementBoamp("971")).toBe("971");
  });
});

describe("BOAMP — champs multivalués", () => {
  it("accepte un tableau, une chaîne JSON ou une chaîne simple", () => {
    const base = { id: "1", dateparution: "2026-08-27" };
    expect(boampRecordSchema.parse({ ...base, titulaire: ["A", " B "] }).titulaire).toEqual(["A", "B"]);
    expect(boampRecordSchema.parse({ ...base, titulaire: '["A","B"]' }).titulaire).toEqual(["A", "B"]);
    expect(boampRecordSchema.parse({ ...base, titulaire: "Seul" }).titulaire).toEqual(["Seul"]);
    expect(boampRecordSchema.parse({ ...base, titulaire: null }).titulaire).toEqual([]);
    expect(boampRecordSchema.parse({ ...base, code_departement: ["3"] }).code_departement).toEqual(["3"]);
  });
});

describe("BOAMP — normalisation", () => {
  const [attribution, ao, rectificatif] = boampAdapter.fixture();

  it("une attribution donne un MARCHE_ATTRIBUE par titulaire distinct, à rapprocher par nom", () => {
    const records = boampAdapter.normalize(attribution);
    expect(records).toHaveLength(2); // « Saines développement SAS » cité deux fois → une fois
    expect(titulairesDe(attribution)).toEqual(["Saines développement SAS", "Aber propreté azur SAS"]);
    for (const r of records) {
      expect(r.kind).toBe("signal");
      if (r.kind !== "signal") continue;
      expect(r.signal.type).toBe("MARCHE_ATTRIBUE");
      expect(r.signal.siret).toBeNull();
      expect(r.signal.rapprochement?.departement).toBe("03");
      expect(r.signal.payload.acheteurNom).toBe("Ville Vichy");
      expect(r.signal.payload.montant).toBeNull();
      expect(r.signal.romes).toContain("K2204"); // nettoyage de locaux
      expect(r.signal.rawRef).toMatch(/^boamp-26-83186-\d$/);
    }
    const noms = records.map((r) => (r.kind === "signal" ? r.signal.rapprochement?.denomination : null));
    expect(noms).toEqual(["Saines développement SAS", "Aber propreté azur SAS"]);
  });

  it("un appel d'offres ouvert donne un AO_OUVERT de bassin, sans SIRET ni rapprochement", () => {
    const records = boampAdapter.normalize(ao);
    expect(records).toHaveLength(1);
    const r = records[0];
    expect(r.kind).toBe("signal");
    if (r.kind !== "signal") return;
    expect(r.signal.type).toBe("AO_OUVERT");
    expect(r.signal.siret).toBeNull();
    expect(r.signal.siren).toBeNull();
    expect(r.signal.rapprochement).toBeUndefined();
    expect(r.signal.romes).toEqual(expect.arrayContaining(["F1702", "F1302"])); // voirie
    expect(r.signal.payload.dateLimite).toBe(ao.datelimitereponse);
    expect(r.signal.rawRef).toBe("ao-26-83001");
  });

  it("un appel d'offres dont la date limite est passée depuis longtemps est ignoré", () => {
    const vieux = { ...ao, datelimitereponse: "2025-01-01T12:00:00+00:00" };
    expect(boampAdapter.normalize(vieux)).toHaveLength(0);
  });

  it("les autres natures (rectificatif…) ne produisent rien", () => {
    expect(boampAdapter.normalize(rectificatif)).toHaveLength(0);
  });

  it("les mentions « sans suite » ne sont pas des titulaires", () => {
    const sansSuite = { ...attribution, titulaire: ["Déclaré sans suite", ""] };
    expect(boampAdapter.normalize(sansSuite)).toHaveLength(0);
  });

  it("les marchés intellectuels n'induisent aucun métier", () => {
    const moe = { ...attribution, objet: "Maîtrise d'œuvre", descripteur_libelle: ["Maîtrise d'oeuvre"] };
    const r = boampAdapter.normalize(moe)[0];
    expect(r.kind === "signal" && r.signal.romes).toEqual([]);
  });
});
