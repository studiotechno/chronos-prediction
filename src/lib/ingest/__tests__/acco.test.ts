import { describe, expect, it } from "vitest";
import { accoAdapter, concerneZone, parseAccoXml, prefixeCodePostal } from "../adapters/acco";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<TEXTE_ACCO>
<META>
<META_SPEC>
<META_ACCO>
<TITRE_TXT>Accord sur le temps de travail</TITRE_TXT>
<NUMERO>T00326000099</NUMERO>
<SIRET>90090000100019</SIRET>
<DATE_TEXTE>2026-07-12</DATE_TEXTE>
<DATE_EFFET>2026-08-01</DATE_EFFET>
<DATE_FIN>2029-08-01</DATE_FIN>
<DATE_DIFFUSION>2026-08-24</DATE_DIFFUSION>
<CODE_APE>4399C</CODE_APE>
<CODE_IDCC>1597</CODE_IDCC>
<RAISON_SOCIALE>DEMO BATIMENT BOURBONNAIS</RAISON_SOCIALE>
<NATURE>ACCORD</NATURE>
<THEMES>
<THEME><CODE>052</CODE><LIBELLE>Heures supplémentaires (contingent, majoration)</LIBELLE><GROUPE>03</GROUPE></THEME>
<THEME><CODE>131</CODE><LIBELLE>Autre, précisez</LIBELLE><GROUPE>11</GROUPE></THEME>
</THEMES>
<SIGNATAIRES><SIGNATAIRE>91</SIGNATAIRE></SIGNATAIRES>
<NEGOCIATEURS><NEGOCIATEUR><NOM>DUPONT</NOM><PRENOM>Jean</PRENOM></NEGOCIATEUR></NEGOCIATEURS>
<ADRESSES_POSTALES>
<ADRESSE_POSTALE><TYPE_ADRESSE>P</TYPE_ADRESSE><CODE_POSTAL>03200</CODE_POSTAL><VILLE>VICHY</VILLE></ADRESSE_POSTALE>
</ADRESSES_POSTALES>
</META_ACCO>
</META_SPEC>
</META>
</TEXTE_ACCO>`;

describe("ACCO — parsing XML", () => {
  it("extrait les métadonnées de l'accord, thèmes et code postal compris", () => {
    const raw = parseAccoXml(XML);
    expect(raw).not.toBeNull();
    expect(raw!.numero).toBe("T00326000099");
    expect(raw!.siret).toBe("90090000100019");
    expect(raw!.codeIdcc).toBe("1597");
    expect(raw!.dateEffet).toBe("2026-08-01");
    expect(raw!.codePostal).toBe("03200");
    expect(raw!.themes.map((t) => t.code)).toEqual(["052", "131"]);
  });

  it("ne lit aucune personne physique", () => {
    const raw = parseAccoXml(XML)!;
    expect(JSON.stringify(raw)).not.toMatch(/DUPONT|Jean/);
  });

  it("rejette un XML sans SIRET exploitable et un code postal « 00000 »", () => {
    expect(parseAccoXml(XML.replace("<SIRET>90090000100019</SIRET>", "<SIRET></SIRET>"))).toBeNull();
    expect(parseAccoXml(XML.replace("<CODE_POSTAL>03200</CODE_POSTAL>", "<CODE_POSTAL>00000</CODE_POSTAL>"))!.codePostal).toBeNull();
  });
});

describe("ACCO — filtre de zone", () => {
  const raw = parseAccoXml(XML)!;
  it("garde un accord du département, ou d'un SIREN du référentiel", () => {
    expect(prefixeCodePostal("03")).toBe("03");
    expect(prefixeCodePostal("2A")).toBe("20");
    expect(concerneZone(raw, "03", new Set())).toBe(true);
    expect(concerneZone(raw, "63", new Set())).toBe(false);
    expect(concerneZone(raw, "63", new Set(["900900001"]))).toBe(true);
    expect(concerneZone({ ...raw, codePostal: null }, "03", new Set())).toBe(false);
  });
});

describe("ACCO — normalisation", () => {
  const [surcharge, restructuration, interessement] = accoAdapter.fixture();

  it("heures supplémentaires et modulation → ACCORD_SURCHARGE, date d'effet, libellés lisibles", () => {
    const records = accoAdapter.normalize(surcharge);
    expect(records).toHaveLength(1);
    const r = records[0];
    if (r.kind !== "signal") throw new Error("signal attendu");
    expect(r.signal.type).toBe("ACCORD_SURCHARGE");
    expect(r.signal.siret).toBe("90090000100019");
    expect(r.signal.siren).toBe("900900001");
    expect(r.signal.occurredAt).toBe(`${surcharge.dateTexte ?? surcharge.dateDiffusion}T00:00:00.000Z`);
    expect(r.signal.payload.dateEffet).toBe(surcharge.dateEffet);
    expect(r.signal.payload.themes).toEqual(["052", "059"]);
    expect(r.signal.payload.themesFr).toBe("heures supplémentaires, aménagement du temps de travail (modulation, annualisation)");
    expect(r.signal.rawRef).toBe("acco-T00326000001");
  });

  it("un PSE l'emporte sur un thème de surcharge présent dans le même accord", () => {
    const r = accoAdapter.normalize(restructuration)[0];
    if (r.kind !== "signal") throw new Error("signal attendu");
    expect(r.signal.type).toBe("ACCORD_RESTRUCTURATION");
    expect(r.signal.payload.themes).toEqual(["075"]);
  });

  it("un accord sans thème de surcharge ni de restructuration ne produit rien", () => {
    expect(accoAdapter.normalize(interessement)).toHaveLength(0);
  });
});
