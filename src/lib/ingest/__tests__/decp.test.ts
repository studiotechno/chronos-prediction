import { describe, expect, it } from "vitest";
import { clauseLieu, decpAdapter } from "../adapters/decp";

describe("DECP — lieu d'exécution", () => {
  it("le filtre couvre le département, le code postal et la commune", () => {
    const c = clauseLieu("03");
    expect(c).toContain('lieuexecution_code="03" and lieuexecution_typecode="Code département"');
    expect(c).toContain('startswith(lieuexecution_code,"03")');
    expect(c).toContain('"Code postal","Code commune"');
  });

  it("le signal porte le lieu géocodé quand la lecture l'a posé, et le codage brut dans le payload", () => {
    const [cp] = decpAdapter.fixture();
    const records = decpAdapter.normalize({ ...cp, lieu: { lat: 46.13, lon: 3.43, libelle: "Vichy" } });
    expect(records).toHaveLength(1);
    const r = records[0];
    if (r.kind !== "signal") return;
    expect(r.signal.lieu).toEqual({ lat: 46.13, lon: 3.43, libelle: "Vichy" });
    expect(r.signal.payload.lieuExecutionCode).toBe("03200");
    expect(r.signal.payload.lieuExecutionType).toBe("Code postal");
    expect(r.signal.siret).toBe("90090000100019");
    expect(r.signal.romes).toEqual(expect.arrayContaining(["F1702"]));
  });
});
