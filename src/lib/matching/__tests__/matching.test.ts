import { describe, expect, it } from "vitest";
import { normalizeDenomination } from "../normalize";
import { jaroWinkler } from "../jaro-winkler";
import { trigramSimilarity } from "../trigram";
import { similarite, matchEntity, SEUIL_AUTO, SEUIL_AMBIGU, type CandidatEtab } from "../match";

describe("normalisation de raison sociale", () => {
  const cas: [string, string][] = [
    ["SARL BÂTIR PROVENCE", "BATIR PROVENCE"],
    ["S.A.R.L. Bâtir Provence", "BATIR PROVENCE"],
    ["ÉTABLISSEMENTS ROUX & FILS", "ROUX FILS"],
    ["STE MARTINEZ BTP", "MARTINEZ BTP"],
    ["TRANSPORTS-MÉDITERRANÉE", "TRANSPORTS MEDITERRANEE"],
    ["Société PROVENCE NETTOYAGE (SAS)", "PROVENCE NETTOYAGE"],
    ["SASU L'ÉTOILE DU SUD", "L ETOILE DU SUD"],
    ["GIE   COMPAGNIE   MARITIME  ", "MARITIME"],
  ];
  it.each(cas)("« %s » → « %s »", (brut, attendu) => {
    expect(normalizeDenomination(brut)).toBe(attendu);
  });
});

describe("briques de similarité", () => {
  it("Jaro-Winkler : valeur de référence MARTHA/MARHTA", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.961, 2);
  });
  it("trigrammes : identité et disjonction", () => {
    expect(trigramSimilarity("BATIMENT", "BATIMENT")).toBe(1);
    expect(trigramSimilarity("BATIMENT", "XYZW")).toBe(0);
  });
});

/**
 * 30+ paires réalistes. Trois bandes de décision :
 *   auto   : score ≥ 0.88
 *   ambigu : 0.62 ≤ score < 0.88
 *   rejet  : score < 0.62
 */
type Paire = [string, string, "auto" | "ambigu" | "rejet"];

const PAIRES: Paire[] = [
  // --- identiques après normalisation (formes juridiques, accents, ponctuation)
  ["SARL BÂTIR PROVENCE", "BATIR PROVENCE", "auto"],
  ["STE NOUVELLE BATIR PROVENCE", "BATIR PROVENCE", "ambigu"],
  ["MARTINEZ CARRELAGES S.A.S.", "MARTINEZ CARRELAGES", "auto"],
  ["TRANSPORTS DURAND ET FILS", "TRANSPORTS DURAND & FILS", "auto"],
  ["ETS GARNIER", "GARNIER", "auto"],
  ["L.M. BÂTIMENT", "LM BATIMENT", "auto"],
  // --- variations légères (pluriel, coquille, inversion de mots)
  ["MARTINEZ CARRELAGE", "MARTINEZ CARRELAGES", "auto"],
  ["DURAND TRANSPORTS", "TRANSPORTS DURAND", "auto"],
  ["MECANIQUE GENERALE PHOCEENNE", "MECANIQUE GENERAL PHOCEENNE", "auto"],
  ["LOGISTIQUE AZUR", "LOGISTIQUE-AZUR", "auto"],
  ["MENUISERIE FABRE", "MENUISERIE FABRE FRERES", "ambigu"],
  ["NETTOYAGE PROVENCAL", "NETTOYAGES PROVENCAUX", "ambigu"],
  // --- groupes et enseignes locales : le tronc commun est là, le suffixe diverge
  ["SPIE BATIGNOLLES", "SPIE BATIGNOLLES SUD EST", "ambigu"],
  ["AXIMA CONCEPT", "AXIMA CONCEPT MEDITERRANEE", "ambigu"],
  ["PROVENCE NETTOYAGE", "PROVENCE NETTOYAGE INDUSTRIEL", "ambigu"],
  ["BATIR PROVENCE AUBAGNE", "BATIR PROVENCE", "ambigu"],
  ["TRANSPORTS ROUX", "TRANSPORTS ROUX LOCATION", "ambigu"],
  ["VINCI CONSTRUCTION", "VINCI CONSTRUCTION FRANCE", "ambigu"],
  ["EIFFAGE ENERGIE", "EIFFAGE ENERGIE SYSTEMES MEDITERRANEE", "ambigu"],
  ["CHARPENTE MODERNE", "CHARPENTES MODERNES DU SUD", "ambigu"],
  // --- pièges : mots partagés mais entreprises différentes (le rejet est le bon réflexe)
  ["GARAGE DU PRADO", "BOULANGERIE DU PRADO", "rejet"],
  ["MACONNERIE CALANQUES", "MENUISERIE CALANQUES", "ambigu"],
  // --- rejets nets : enseigne ≠ raison sociale, abréviations, homonymie nulle
  ["MCDONALD'S AUBAGNE", "SODIREST", "rejet"],
  ["SMN PROPRETE", "SOCIETE MEDITERRANEENNE DE NETTOYAGE", "rejet"],
  ["ALPHA CONSEIL", "OMEGA TRANSPORTS", "rejet"],
  ["BOULANGERIE PAUL", "PHOCEENNE DE RESTAURATION", "rejet"],
  ["LE PETIT NICE", "PASSEDAT EXPLOITATION", "rejet"],
  ["ATELIER 13", "GRUES ET LEVAGE MARSEILLAIS", "rejet"],
  ["CARREFOUR MARSEILLE", "CSF FRANCE", "rejet"],
  ["INTERMARCHE AUBAGNE", "ITM ENTREPRISES", "rejet"],
  ["PIZZERIA CHEZ MARIO", "SARL MB RESTAURATION", "rejet"],
  ["OPTIQUE DE LA VALENTINE", "VISION SUD EST", "rejet"],
];

describe("similarité combinée : 32 paires réalistes", () => {
  it.each(PAIRES)("« %s » vs « %s » → %s", (a, b, attendu) => {
    const score = similarite(a, b);
    const bande = score >= SEUIL_AUTO ? "auto" : score >= SEUIL_AMBIGU ? "ambigu" : "rejet";
    expect(bande, `score obtenu : ${score}`).toBe(attendu);
  });
});

describe("matchEntity : blocage et décisions", () => {
  const referentiel: CandidatEtab[] = [
    { siret: "11111111100011", denomination: "BATIR PROVENCE", codePostal: "13400", commune: "Aubagne", naf: "43.99C" },
    { siret: "22222222200011", denomination: "BATIR PROVENCE", codePostal: "13127", commune: "Vitrolles", naf: "43.99C" },
    { siret: "33333333300011", denomination: "TRANSPORTS ROUX", codePostal: "13011", commune: "Marseille 11e", naf: "49.41A" },
    { siret: "44444444400011", denomination: "MENUISERIE FABRE", codePostal: "13400", commune: "Aubagne", naf: "43.32A" },
    { siret: "55555555500011", denomination: "CONSEIL AZUR STRATEGIE", codePostal: "13008", commune: "Marseille 8e", naf: "70.22Z" },
  ];

  it("le blocage par code postal choisit le bon établissement homonyme", () => {
    const r = matchEntity({ denomination: "SARL BATIR PROVENCE", codePostal: "13127" }, referentiel);
    expect(r.decision).toBe("auto");
    if (r.decision === "auto") expect(r.candidat.siret).toBe("22222222200011");
  });

  it("sans code postal, le référentiel entier est balayé", () => {
    const r = matchEntity({ denomination: "TRANSPORTS ROUX" }, referentiel);
    expect(r.decision).toBe("auto");
    if (r.decision === "auto") expect(r.candidat.siret).toBe("33333333300011");
  });

  it("un nom proche mais pas identique part en file de résolution", () => {
    const r = matchEntity({ denomination: "TRANSPORTS ROUX LOCATION", codePostal: "13011" }, referentiel);
    expect(r.decision).toBe("ambigu");
    if (r.decision === "ambigu") {
      expect(r.candidats[0].siret).toBe("33333333300011");
      expect(r.candidats[0].similarite).toBeGreaterThanOrEqual(SEUIL_AMBIGU);
      expect(r.candidats[0].similarite).toBeLessThan(SEUIL_AUTO);
    }
  });

  it("un nom sans rapport est rejeté", () => {
    const r = matchEntity({ denomination: "KEBAB DU VIEUX PORT", codePostal: "13001" }, referentiel);
    expect(r.decision).toBe("rejet");
  });

  it("le bonus NAF pousse un cas limite au-dessus du seuil", () => {
    const sans = similarite("MENUISERIE FABRE ET FILS", "MENUISERIE FABRE");
    const avec = similarite("MENUISERIE FABRE ET FILS", "MENUISERIE FABRE", "43.32A", "43.32B");
    expect(avec).toBeGreaterThan(sans);
    expect(avec - sans).toBeCloseTo(0.04, 2);
  });
});
