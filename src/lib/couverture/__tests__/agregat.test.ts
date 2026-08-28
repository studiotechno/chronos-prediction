import { describe, expect, it } from "vitest";
import {
  agregerEnseignes,
  cleCellule,
  construireGrille,
  litCleCellule,
  metiersSansEcho,
  opportunites,
  serieHebdo,
  tendance,
  tendancesFiables,
  type MissionCouverture,
} from "../agregat";
import { appliquerFiltres, FILTRES_DEFAUT } from "../filtres";
import { casseEnseigne, intituleLisible } from "../libelles";

const NOW = new Date("2026-08-27T12:00:00Z").getTime();
const JOUR = 86400000;

function iso(joursAvant: number): string {
  return new Date(NOW - joursAvant * JOUR).toISOString();
}

function mission(p: Partial<MissionCouverture> & { joursAvant: number }): MissionCouverture {
  return {
    commune: p.commune ?? "Moulins",
    rome: p.rome ?? "N1101",
    agence: p.agence ?? "Adecco",
    intitule: p.intitule ?? "Cariste (H/F)",
    date: iso(p.joursAvant),
  };
}

const OPTIONS = { now: NOW, demiVie: 60, fenetreJours: 90, tri: "volume" as const, libelles: {} };

describe("clé de cellule", () => {
  it("survit aux communes qui contiennent des espaces", () => {
    const cle = cleCellule("Saint-Didier-la-Forêt", "F1704");
    expect(litCleCellule(cle)).toEqual({ commune: "Saint-Didier-la-Forêt", rome: "F1704" });
    expect(litCleCellule(cleCellule("Le Donjon", "N1101")).commune).toBe("Le Donjon");
  });
});

describe("construction de la grille", () => {
  const missions = [
    mission({ joursAvant: 1, commune: "Moulins", rome: "N1101", agence: "Adecco" }),
    mission({ joursAvant: 2, commune: "Moulins", rome: "N1101", agence: "Manpower" }),
    mission({ joursAvant: 80, commune: "Moulins", rome: "F1703", agence: "Adecco" }),
    mission({ joursAvant: 3, commune: "Vichy", rome: "N1101", agence: "Crit" }),
  ];

  it("agrège les cellules et compte les enseignes distinctes", () => {
    const g = construireGrille(missions, OPTIONS);
    const cellule = g.cellules.get(cleCellule("Moulins", "N1101"))!;
    expect(cellule.nb).toBe(2);
    expect(cellule.agences.map((a) => a.nom)).toEqual(["Adecco", "Manpower"]);
    expect(g.parCommune.get("Moulins")!.nb).toBe(3);
    expect(g.parCommune.get("Moulins")!.enseignes).toBe(2);
    expect(g.parRome.get("N1101")!.nb).toBe(3);
  });

  it("classe par intensité, donc une mission récente pèse plus qu'une vieille", () => {
    const g = construireGrille(missions, OPTIONS);
    expect(g.romes[0]).toBe("N1101");
    // Vichy n'a qu'une mission récente, Moulins en a trois dont deux d'hier.
    expect(g.communes).toEqual(["Moulins", "Vichy"]);
  });

  it("trie alphabétiquement sur le libellé métier, pas sur le code", () => {
    const g = construireGrille(missions, {
      ...OPTIONS,
      tri: "alpha",
      libelles: { N1101: "Zèbre", F1703: "Alpage" },
    });
    expect(g.romes).toEqual(["F1703", "N1101"]);
    expect(g.communes).toEqual(["Moulins", "Vichy"]);
  });
});

describe("tendance", () => {
  it("se tait quand la matière est trop mince", () => {
    expect(tendance([mission({ joursAvant: 1 })], NOW, 60)).toBeNull();
  });

  it("compare les deux moitiés de la fenêtre", () => {
    const missions = [
      ...Array.from({ length: 6 }, () => mission({ joursAvant: 5 })),
      ...Array.from({ length: 3 }, () => mission({ joursAvant: 40 })),
    ];
    const t = tendance(missions, NOW, 60)!;
    expect(t.recent).toBe(6);
    expect(t.precedent).toBe(3);
    expect(t.delta).toBeCloseTo(1);
  });

  it("ignore ce qui déborde de la fenêtre", () => {
    const missions = [
      ...Array.from({ length: 4 }, () => mission({ joursAvant: 2 })),
      ...Array.from({ length: 5 }, () => mission({ joursAvant: 200 })),
    ];
    const t = tendance(missions, NOW, 60)!;
    expect(t.recent).toBe(4);
    expect(t.precedent).toBe(0);
  });

  it("juge non fiable une fenêtre dont la moitié ancienne est sous-collectée", () => {
    const recentes = Array.from({ length: 20 }, () => mission({ joursAvant: 5 }));
    const anciennes = Array.from({ length: 2 }, () => mission({ joursAvant: 70 }));
    expect(tendancesFiables([...recentes, ...anciennes], NOW, 90)).toBe(false);

    const equilibrees = [
      ...Array.from({ length: 10 }, () => mission({ joursAvant: 5 })),
      ...Array.from({ length: 8 }, () => mission({ joursAvant: 70 })),
    ];
    expect(tendancesFiables(equilibrees, NOW, 90)).toBe(true);
  });
});

describe("série hebdomadaire", () => {
  it("range les missions de la plus ancienne à la plus récente", () => {
    const serie = serieHebdo(
      [mission({ joursAvant: 1 }), mission({ joursAvant: 2 }), mission({ joursAvant: 20 })],
      NOW,
      28,
    );
    expect(serie).toHaveLength(4);
    expect(serie[serie.length - 1]).toBe(2);
    expect(serie.reduce((s, v) => s + v, 0)).toBe(3);
  });
});

describe("agrégation des enseignes", () => {
  it("classe par volume et calcule la part du bassin", () => {
    const missions = [
      mission({ joursAvant: 1, agence: "Adecco", commune: "Moulins" }),
      mission({ joursAvant: 2, agence: "Adecco", commune: "Vichy" }),
      mission({ joursAvant: 3, agence: "Crit", commune: "Moulins" }),
      mission({ joursAvant: 4, agence: "Crit", commune: "Moulins" }),
      mission({ joursAvant: 5, agence: "Crit", commune: "Moulins" }),
    ];
    const [premiere, seconde] = agregerEnseignes(missions, { now: NOW, fenetreJours: 90 });
    expect(premiere.nom).toBe("Crit");
    expect(premiere.nb).toBe(3);
    expect(premiere.part).toBeCloseTo(60);
    expect(seconde.communes.map((c) => c.cle).sort()).toEqual(["Moulins", "Vichy"]);
  });
});

describe("terrain à prendre", () => {
  const missions = [
    mission({ joursAvant: 1, commune: "Moulins", rome: "N1101", agence: "Adecco" }),
    mission({ joursAvant: 2, commune: "Moulins", rome: "N1101", agence: "Chronos Moulins" }),
    mission({ joursAvant: 3, commune: "Vichy", rome: "N1101", agence: "Crit" }),
    mission({ joursAvant: 4, commune: "Vichy", rome: "H2903", agence: "Crit" }),
  ];

  it("sépare les missions de l'agence de celles des concurrents", () => {
    const g = construireGrille(missions, OPTIONS);
    const opp = opportunites(g, missions, ["N1101"], {
      now: NOW,
      fenetreJours: 90,
      enseigneAgence: "Chronos Moulins",
    });
    const moulins = opp.find((o) => o.commune === "Moulins")!;
    expect(moulins.nous).toBe(1);
    expect(moulins.concurrents).toBe(1);
    expect(moulins.dominante?.nom).toBe("Adecco");
    // Vichy, où l'agence est absente, passe devant malgré un volume identique.
    expect(opp[0].commune).toBe("Vichy");
  });

  it("ne retient que les métiers placés par l'agence", () => {
    const g = construireGrille(missions, OPTIONS);
    const opp = opportunites(g, missions, ["N1101"], {
      now: NOW,
      fenetreJours: 90,
      enseigneAgence: null,
    });
    expect(opp.every((o) => o.rome === "N1101")).toBe(true);
  });

  it("liste les métiers ciblés dont le bassin ne parle pas", () => {
    const g = construireGrille(missions, OPTIONS);
    expect(metiersSansEcho(g, ["N1101", "F1703"], { F1703: "Maçonnerie" })).toEqual([
      { rome: "F1703", libelle: "Maçonnerie" },
    ]);
  });
});

describe("filtres", () => {
  const missions = [
    mission({ joursAvant: 5, commune: "Moulins", rome: "N1101", agence: "Adecco" }),
    mission({
      joursAvant: 70,
      commune: "Vichy",
      rome: "F1703",
      agence: "Crit",
      intitule: "Maçon (H/F)",
    }),
  ];
  const contexte = { now: NOW, romeCibles: ["N1101"], libelles: { N1101: "Cariste" } };

  it("coupe sur la fenêtre demandée", () => {
    const out = appliquerFiltres(missions, { ...FILTRES_DEFAUT, fenetre: 30 }, contexte);
    expect(out).toHaveLength(1);
    expect(out[0].commune).toBe("Moulins");
  });

  it("cherche sur la commune, le métier, l'enseigne et l'intitulé, sans accent ni casse", () => {
    expect(appliquerFiltres(missions, { ...FILTRES_DEFAUT, q: "vichy" }, contexte)).toHaveLength(1);
    expect(appliquerFiltres(missions, { ...FILTRES_DEFAUT, q: "CARISTE" }, contexte)).toHaveLength(1);
    expect(appliquerFiltres(missions, { ...FILTRES_DEFAUT, q: "crit" }, contexte)).toHaveLength(1);
  });

  it("restreint aux métiers de l'agence", () => {
    const out = appliquerFiltres(missions, { ...FILTRES_DEFAUT, mesMetiers: true }, contexte);
    expect(out.map((m) => m.rome)).toEqual(["N1101"]);
  });

  it("retient les enseignes cochées", () => {
    const out = appliquerFiltres(missions, { ...FILTRES_DEFAUT, enseignes: ["Crit"] }, contexte);
    expect(out.map((m) => m.agence)).toEqual(["Crit"]);
  });
});

describe("libellés de source", () => {
  it("rend les enseignes lisibles sans casser les sigles", () => {
    expect(casseEnseigne("MANPOWER FRANCE")).toBe("Manpower France");
    expect(casseEnseigne("LIP VICHY")).toBe("LIP Vichy");
    expect(casseEnseigne("Adecco Medical")).toBe("Adecco Medical");
  });

  it("nettoie les intitulés qui crient et leurs mentions H/F", () => {
    expect(intituleLisible("INFIRMIER (H/F)")).toBe("Infirmier");
    expect(intituleLisible("Cariste (h/f)")).toBe("Cariste");
    expect(intituleLisible("Chef d'équipe")).toBe("Chef d'équipe");
  });
});
