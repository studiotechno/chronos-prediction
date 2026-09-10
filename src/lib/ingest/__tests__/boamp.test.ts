import { describe, expect, it } from "vitest";
import {
  boampAdapter,
  boampRecordSchema,
  departementBoamp,
  lireDonnees,
  marchesSemblables,
  picRenouvellement,
  titulairesDe,
} from "../adapters/boamp";

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

  it("une attribution donne un MARCHE_ATTRIBUE par titulaire distinct, avec montant cumulé, CPV et code postal", () => {
    const records = boampAdapter.normalize(attribution);
    expect(records).toHaveLength(2); // « Saines développement SAS » cité sur deux lots → une fois
    expect(titulairesDe(attribution)).toEqual(["Saines développement SAS", "Aber propreté azur SAS"]);
    for (const r of records) {
      expect(r.kind).toBe("signal");
      if (r.kind !== "signal") continue;
      expect(r.signal.type).toBe("MARCHE_ATTRIBUE");
      expect(r.signal.siret).toBeNull();
      expect(r.signal.rapprochement?.departement).toBe("03");
      expect(r.signal.payload.acheteurNom).toBe("Ville Vichy");
      expect(r.signal.payload.cpv).toBe("90911200");
      expect(r.signal.payload.appelOffres).toBe("26-40001");
      expect(r.signal.romes).toContain("K2204"); // nettoyage de locaux
      expect(r.signal.rawRef).toMatch(/^boamp-26-83186-\d$/);
      // datée de l'attribution (20 jours avant la parution), pas de la parution
      expect(r.signal.occurredAt.slice(0, 10)).toBe(attribution.donnees ? JSON.parse(attribution.donnees as string).ATTRIBUTION.DECISION[0].RENSEIGNEMENT.DATE_ATTRIBUTION : "");
    }
    const [saines, aber] = records.map((r) => (r.kind === "signal" ? r.signal : null));
    expect(saines?.rapprochement?.denomination).toBe("Saines développement SAS");
    expect(saines?.rapprochement?.codePostal).toBe("03200");
    expect(saines?.payload.montant).toBe(150000); // lots 1 + 3
    expect(saines?.payload.nbLots).toBe(2);
    expect(aber?.rapprochement?.codePostal).toBe("03300");
    expect(aber?.payload.montant).toBe(80000);
  });

  it("sans avis structuré, on retombe sur les colonnes plates : nom seul, montant inconnu", () => {
    const plat = { ...attribution, donnees: null };
    const records = boampAdapter.normalize(plat);
    expect(records).toHaveLength(2);
    const r = records[0];
    if (r.kind !== "signal") return;
    expect(r.signal.payload.montant).toBeNull();
    expect(r.signal.rapprochement?.codePostal).toBeNull();
    expect(r.signal.occurredAt.slice(0, 10)).toBe(attribution.dateparution);
  });

  it("un appel d'offres ouvert donne un AO_OUVERT de bassin, sans SIRET ni rapprochement", () => {
    const records = boampAdapter.normalize({ ...ao, renouvellements: [] });
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
    expect(r.signal.payload.cpv).toBe("45233140");
    expect(r.signal.rawRef).toBe("ao-26-83001");
  });

  it("un appel d'offres qui relance un marché semblable désigne le titulaire sortant : AO_RENOUVELLEMENT, pic calé sur la date limite", () => {
    const records = boampAdapter.normalize(ao);
    expect(records.map((r) => (r.kind === "signal" ? r.signal.type : null))).toEqual(["AO_OUVERT", "AO_RENOUVELLEMENT"]);
    const r = records[1];
    if (r.kind !== "signal") return;
    expect(r.signal.rapprochement?.denomination).toBe("DEMO TP BOURBONNAIS");
    expect(r.signal.rapprochement?.codePostal).toBe("03500");
    expect(r.signal.payload.montant).toBe(210000);
    expect(r.signal.payload.idwebPrecedent).toBe("22-11111");
    expect(r.signal.rawRef).toBe("renouv-26-83001-0");
    // parution il y a 2 jours, limite dans 30 jours → 32 + 60 jours
    expect(picRenouvellement(ao)).toBe(92);
    expect(r.signal.payload.picJours).toBe(92);
  });

  it("un appel d'offres dont la date limite est passée depuis longtemps est ignoré", () => {
    const vieux = { ...ao, datelimitereponse: "2025-01-01T12:00:00+00:00" };
    expect(boampAdapter.normalize(vieux)).toHaveLength(0);
  });

  it("les autres natures (rectificatif…) ne produisent rien", () => {
    expect(boampAdapter.normalize(rectificatif)).toHaveLength(0);
  });

  it("les mentions « sans suite » ne sont pas des titulaires", () => {
    const sansSuite = { ...attribution, titulaire: ["Déclaré sans suite", ""], donnees: null };
    expect(boampAdapter.normalize(sansSuite)).toHaveLength(0);
    const structure = {
      ...attribution,
      titulaire: [],
      donnees: JSON.stringify({ ATTRIBUTION: { DECISION: { TITULAIRE: { DENOMINATION: "Infructueux" } } } }),
    };
    expect(boampAdapter.normalize(structure)).toHaveLength(0);
  });

  it("les marchés intellectuels n'induisent aucun métier", () => {
    const moe = { ...attribution, objet: "Maîtrise d'œuvre", descripteur_libelle: ["Maîtrise d'oeuvre"] };
    const r = boampAdapter.normalize(moe)[0];
    expect(r.kind === "signal" && r.signal.romes).toEqual([]);
  });
});

describe("BOAMP — avis structuré (donnees)", () => {
  it("lit l'acheteur, les CPV, le lieu d'exécution et chaque décision, que les nœuds soient objets ou tableaux", () => {
    const lues = lireDonnees(
      JSON.stringify({
        IDENTITE: { CP: "03600", VILLE: "COMMENTRY" },
        OBJET: {
          CPV: [{ PRINCIPAL: "45400000" }, { PRINCIPAL: "45215100" }],
          LOTS: { LOT: [{ CPV: { PRINCIPAL: "45400000" } }, { CPV: { PRINCIPAL: "45310000" } }] },
          LIEU_EXEC_LIVR: { ADRESSE: "8 rue du Bourbonnais", CODE_NUTS: "FR72" },
        },
        ATTRIBUTION: {
          DECISION: {
            NUM_LOT: 2,
            TITULAIRE: { DENOMINATION: "Rugotech", ADRESSE: "2 Chemin", CP: "31240", VILLE: "L'Union" },
            RENSEIGNEMENT: { DATE_ATTRIBUTION: "2026-08-20", MONTANT: { "@DEVISE": "EUR", "#text": "37503.79" } },
          },
        },
      }),
    );
    expect(lues.acheteurCodePostal).toBe("03600");
    expect(lues.acheteurVille).toBe("COMMENTRY");
    expect(lues.cpv).toEqual(["45400000", "45215100", "45310000"]);
    expect(lues.lieuExecution).toBe("8 rue du Bourbonnais");
    expect(lues.decisions).toEqual([
      { denomination: "Rugotech", codePostal: "31240", ville: "L'Union", montant: 37503.79, dateAttribution: "2026-08-20", numLot: "2" },
    ]);
  });

  it("un JSON invalide, un objet vide ou un montant nul ne cassent rien", () => {
    expect(lireDonnees("pas du json").decisions).toEqual([]);
    expect(lireDonnees(null).cpv).toEqual([]);
    const lues = lireDonnees({ ATTRIBUTION: { DECISION: [{ TITULAIRE: { DENOMINATION: "X" }, RENSEIGNEMENT: { MONTANT: "0" } }] } });
    expect(lues.decisions[0].montant).toBeNull();
    expect(lues.decisions[0].codePostal).toBeNull();
  });
});

describe("BOAMP — anticipation des renouvellements", () => {
  const [attribution, ao] = boampAdapter.fixture();

  it("retient les attributions du même acheteur dont l'objet ressemble, pas les autres", () => {
    const voirieSud = {
      ...attribution,
      idweb: "22-1",
      objet: "Travaux d'aménagement de l'entrée Sud de l'agglomération",
      descripteur_libelle: ["Voirie et réseaux divers"],
    };
    const nettoyage = { ...attribution, idweb: "22-2", objet: "Nettoyage des locaux", descripteur_libelle: ["Nettoyage de locaux"] };
    const memeAvis = { ...attribution, idweb: ao.idweb, objet: ao.objet };
    const retenus = marchesSemblables(ao, [voirieSud, nettoyage, memeAvis]);
    expect(retenus.map((r) => r.idweb)).toEqual(["22-1"]);
  });

  it("le pic est la date limite plus deux mois, jamais moins d'un mois", () => {
    expect(picRenouvellement({ ...ao, datelimitereponse: null })).toBe(105);
    const parution = ao.dateparution;
    expect(picRenouvellement({ ...ao, datelimitereponse: `${parution}T00:00:00Z` })).toBe(60);
  });
});

describe("BOAMP — avis eForms (norme européenne, 2026)", () => {
  const eforms = {
    EFORMS: {
      ContractAwardNotice: {
        "cbc:IssueDate": "2026-09-02+02:00",
        "ext:UBLExtensions": {
          "ext:UBLExtension": {
            "ext:ExtensionContent": {
              "efext:EformsExtension": {
                "efac:NoticeResult": {
                  "cbc:TotalAmount": { "@currencyID": "EUR", "#text": "590880" },
                  "efac:LotResult": [
                    {
                      "cbc:ID": { "@schemeName": "result", "#text": "RES-0001" },
                      "cbc:TenderResultCode": { "@listName": "winner-selection-status", "#text": "selec-w" },
                      "efac:LotTender": { "cbc:ID": { "@schemeName": "tender", "#text": "TEN-0001" } },
                      "efac:SettledContract": { "cbc:ID": { "@schemeName": "contract", "#text": "CON-0001" } },
                      "efac:TenderLot": { "cbc:ID": { "@schemeName": "Lot", "#text": "LOT-0001" } },
                    },
                    {
                      "cbc:ID": { "@schemeName": "result", "#text": "RES-0002" },
                      "cbc:TenderResultCode": { "@listName": "winner-selection-status", "#text": "clos-nw" },
                      "efac:TenderLot": { "cbc:ID": { "@schemeName": "Lot", "#text": "LOT-0002" } },
                    },
                  ],
                  "efac:LotTender": [
                    {
                      "cbc:ID": { "@schemeName": "tender", "#text": "TEN-0001" },
                      "efac:TenderingParty": { "cbc:ID": { "@schemeName": "tendering-party", "#text": "TPA-0001" } },
                      "cac:LegalMonetaryTotal": { "cbc:PayableAmount": { "@currencyID": "EUR", "#text": "87500" } },
                    },
                  ],
                  "efac:TenderingParty": [
                    {
                      "cbc:ID": { "@schemeName": "tendering-party", "#text": "TPA-0001" },
                      "efac:Tenderer": { "cbc:ID": { "@schemeName": "organization", "#text": "ORG-0004" } },
                    },
                  ],
                  "efac:SettledContract": [
                    { "cbc:ID": { "@schemeName": "contract", "#text": "CON-0001" }, "cbc:IssueDate": "2026-08-11+02:00" },
                  ],
                },
                "efac:Organizations": {
                  "efac:Organization": [
                    {
                      "efac:Company": {
                        "cac:PartyIdentification": { "cbc:ID": { "@schemeName": "organization", "#text": "ORG-0002" } },
                        "cac:PartyName": { "cbc:Name": { "@languageID": "FRA", "#text": "SICTOM Nord Allier" } },
                        "cac:PostalAddress": { "cbc:CityName": "Chézy", "cbc:PostalZone": "03230" },
                      },
                    },
                    {
                      "efac:Company": {
                        "cac:PartyIdentification": { "cbc:ID": { "@schemeName": "organization", "#text": "ORG-0004" } },
                        "cac:PartyName": { "cbc:Name": { "@languageID": "FRA", "#text": "FAURIE TRUCKS MOULINS" } },
                        "cac:PostalAddress": { "cbc:CityName": "Avermes", "cbc:PostalZone": "03000" },
                        "cac:PartyLegalEntity": { "cbc:CompanyID": { "@schemeName": "eu", "#text": "1814019-1-1-1" } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        "cac:ContractingParty": {
          "cac:Party": { "cac:PartyIdentification": { "cbc:ID": { "@schemeName": "organization", "#text": "ORG-0002" } } },
        },
        "cac:ProcurementProject": {
          "cac:MainCommodityClassification": { "cbc:ItemClassificationCode": { "@listName": "cpv", "#text": "34144510" } },
          "cac:AdditionalCommodityClassification": [{ "cbc:ItemClassificationCode": { "@listName": "cpv", "#text": "34144700" } }],
          "cac:RealizedLocation": [{ "cac:Address": { "cbc:CountrySubentityCode": { "@listName": "nuts", "#text": "FRK11" } } }],
        },
        "cac:ProcurementProjectLot": [
          {
            "cac:ProcurementProject": {
              "cac:MainCommodityClassification": { "cbc:ItemClassificationCode": { "@listName": "cpv", "#text": "90511000" } },
              "cac:RealizedLocation": { "cac:Address": { "cbc:CityName": "Chézy", "cbc:PostalZone": "03230" } },
            },
          },
        ],
      },
    },
  };

  it("retrouve le gagnant par la chaîne LotResult → LotTender → TenderingParty → Organization, avec montant, adresse et date", () => {
    const lues = lireDonnees(JSON.stringify(eforms));
    expect(lues.acheteurCodePostal).toBe("03230");
    expect(lues.acheteurVille).toBe("Chézy");
    expect(lues.cpv).toEqual(["34144510", "34144700", "90511000"]);
    expect(lues.lieuExecution).toBe("03230 Chézy");
    expect(lues.decisions).toEqual([
      { denomination: "FAURIE TRUCKS MOULINS", codePostal: "03000", ville: "Avermes", montant: 87500, dateAttribution: "2026-08-11", numLot: "LOT-0001" },
    ]);
  });

  it("un avis eForms passe dans la normalisation comme un avis classique", () => {
    const [attribution] = boampAdapter.fixture();
    const avis = { ...attribution, titulaire: ["FAURIE TRUCKS MOULINS"], donnees: JSON.stringify(eforms) };
    const records = boampAdapter.normalize(avis);
    expect(records).toHaveLength(1);
    const r = records[0];
    if (r.kind !== "signal") return;
    expect(r.signal.payload.montant).toBe(87500);
    expect(r.signal.payload.cpv).toBe("34144510");
    expect(r.signal.rapprochement?.codePostal).toBe("03000");
    expect(r.signal.occurredAt.slice(0, 10)).toBe("2026-08-11");
  });
});
