import { describe, expect, it } from "vitest";
import { lireFinances, normaliserResultat, sireneAdapter, sireneResultSchema } from "../adapters/sirene";

/**
 * Réponse réelle de recherche-entreprises.api.gouv.fr pour un établissement à
 * diffusion restreinte (relevée le 27/08/2026 sur le SIRET 94952676800013) :
 * les champs texte ET les coordonnées valent « [NON-DIFFUSIBLE] ».
 */
const NON_DIFFUSIBLE = {
  siren: "949526768",
  nom_complet: "[NON-DIFFUSIBLE]",
  nom_raison_sociale: null,
  categorie_entreprise: null,
  date_creation: "2023-01-01",
  etat_administratif: "A",
  activite_principale: "43.99C",
  tranche_effectif_salarie: null,
  matching_etablissements: [
    {
      siret: "94952676800013",
      activite_principale: "43.99C",
      tranche_effectif_salarie: null,
      code_postal: "69380",
      libelle_commune: "CHAZAY-D'AZERGUES",
      latitude: "[NON-DIFFUSIBLE]",
      longitude: "[NON-DIFFUSIBLE]",
      date_creation: "2023-01-01",
      etat_administratif: "A",
      est_siege: true,
    },
  ],
};

describe("adapter SIRENE — coordonnées non diffusibles", () => {
  it("accepte la réponse telle que la source la publie", () => {
    expect(sireneResultSchema.safeParse(NON_DIFFUSIBLE).success).toBe(true);
  });

  it("normalise une coordonnée non diffusible en null, jamais en NaN", () => {
    const raw = sireneResultSchema.parse(NON_DIFFUSIBLE);
    const [record] = sireneAdapter.normalize(raw);
    expect(record.kind).toBe("etablissement");
    if (record.kind !== "etablissement") throw new Error("type inattendu");
    expect(record.etablissement.lat).toBeNull();
    expect(record.etablissement.lon).toBeNull();
    // Le reste de la fiche doit survivre : commune et NAF restent exploitables.
    expect(record.etablissement.commune).toBe("CHAZAY-D'AZERGUES");
    expect(record.etablissement.naf).toBe("43.99C");
  });

  it("conserve des coordonnées valides", () => {
    const avecPosition = {
      ...NON_DIFFUSIBLE,
      matching_etablissements: [
        { ...NON_DIFFUSIBLE.matching_etablissements[0], latitude: "46.5591", longitude: "3.3255" },
      ],
    };
    const [record] = sireneAdapter.normalize(sireneResultSchema.parse(avecPosition));
    if (record.kind !== "etablissement") throw new Error("type inattendu");
    expect(record.etablissement.lat).toBe(46.5591);
    expect(record.etablissement.lon).toBe(3.3255);
  });
});

/**
 * Réponse réelle de `near_point … &minimal=true&include=finances,complements,siege,
 * matching_etablissements` (Yzeure, 28/08/2026), abrégée.
 */
describe("adapter SIRENE — compléments V2 (finances, IDCC, enseignes, employeur)", () => {
  const [bourbonnais, logistique] = sireneAdapter.fixture();

  it("lit le dernier exercice et le précédent quand il existe", () => {
    expect(lireFinances({ "2024": { ca: 6200000, resultat_net: 210000 }, "2023": { ca: 5100000, resultat_net: 140000 } })).toEqual({
      caAnnee: 2024,
      ca: 6200000,
      caPrecedent: 5100000,
      resultatNet: 210000,
      resultatNetPrecedent: 140000,
    });
  });

  it("ne prend pas un exercice non consécutif pour un précédent", () => {
    const f = lireFinances({ "2024": { ca: 1000000, resultat_net: 1000 }, "2021": { ca: 800000, resultat_net: 500 } });
    expect(f.caAnnee).toBe(2024);
    expect(f.caPrecedent).toBeNull();
    expect(f.resultatNetPrecedent).toBeNull();
  });

  it("traite un chiffre d'affaires à 0 comme inconnu (constaté sur APS, SIREN 440561041)", () => {
    const f = lireFinances({ "2024": { ca: 0, resultat_net: 89531 } });
    expect(f.ca).toBeNull();
    expect(f.resultatNet).toBe(89531);
    expect(lireFinances(null).caAnnee).toBeNull();
  });

  it("porte finances, IDCC, caractère employeur et compléments sur l'entreprise", () => {
    const [record] = sireneAdapter.normalize(bourbonnais);
    if (record.kind !== "etablissement") throw new Error("type inattendu");
    expect(record.entreprise).toMatchObject({
      siren: "900900001",
      caAnnee: 2024,
      ca: 6200000,
      caPrecedent: 5100000,
      resultatNet: 210000,
      caractereEmployeur: "O",
      nbEtabsOuverts: 1,
      idcc: ["1597", "2609"],
      complements: { est_rge: true },
    });
    // Les listes d'identifiants des compléments ne sont jamais recopiées.
    expect(JSON.stringify(record.entreprise.complements)).not.toContain("liste_idcc");
  });

  it("porte code INSEE, IDCC, enseignes et caractère employeur sur l'établissement", () => {
    const [record] = sireneAdapter.normalize(logistique);
    if (record.kind !== "etablissement") throw new Error("type inattendu");
    expect(record.etablissement).toMatchObject({
      codeInsee: "03298",
      idcc: ["16"],
      enseignes: ["DEMO LOG"],
      caractereEmployeur: "O",
      trancheEffectif: "12",
      trancheEffectifSource: "sirene",
      effectifEstime: 35,
      dateDebutActivite: "2016-09-01",
    });
    expect(record.entreprise.ca).toBeNull(); // ca: 0 dans la fixture
  });

  it("une tranche inconnue (NN) n'a pas de source", () => {
    const raw = {
      ...bourbonnais,
      matching_etablissements: [{ ...bourbonnais.matching_etablissements[0], tranche_effectif_salarie: "NN" }],
    };
    const [record] = sireneAdapter.normalize(raw);
    if (record.kind !== "etablissement") throw new Error("type inattendu");
    expect(record.etablissement.trancheEffectif).toBe("NN");
    expect(record.etablissement.trancheEffectifSource).toBeNull();
    expect(record.etablissement.effectifEstime).toBeNull();
  });

  it("lit le siège quand la recherche par SIREN ne renvoie aucun matching (constaté le 28/08/2026)", () => {
    const parSiren = {
      ...bourbonnais,
      matching_etablissements: [],
      siege: bourbonnais.matching_etablissements[0],
    };
    const lu = normaliserResultat(parSiren);
    expect(lu.etablissements).toHaveLength(1);
    expect(lu.etablissements[0].siret).toBe("90090000100019");
    expect(lu.etablissements[0].estSiege).toBe(1);
  });

  it("ne duplique pas un siège qui figure aussi dans les établissements", () => {
    const lu = normaliserResultat({ ...bourbonnais, siege: bourbonnais.matching_etablissements[0] });
    expect(lu.etablissements).toHaveLength(1);
  });

  it("sur near_point, ne garde que les établissements du rayon (pas le siège lointain)", () => {
    const siegeParis = {
      ...bourbonnais.matching_etablissements[0],
      siret: "90090000100099",
      code_postal: "75008",
      libelle_commune: "PARIS",
      commune: "75108",
    };
    const records = sireneAdapter.normalize({ ...bourbonnais, siege: siegeParis });
    expect(records.map((r) => (r.kind === "etablissement" ? r.etablissement.siret : ""))).toEqual(["90090000100019"]);
  });
});
