import { getCouverture } from "@/lib/queries";
import { romeLabel } from "@/lib/reference/rome";

export const dynamic = "force-dynamic";

/**
 * Carte de couverture concurrentielle : missions d'intérim postées par des agences
 * sur le bassin, agrégées par commune et par ROME, avec décroissance temporelle.
 * Une cellule foncée = présence concurrentielle forte et récente.
 */
export default function CouverturePage() {
  const { cellules, romes, communes, agences, maxIntensite, libellesRome, total } = getCouverture();
  const libelle = (r: string) => libellesRome.get(r) ?? romeLabel(r);
  const romesAffiches = romes.slice(0, 10);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Couverture concurrentielle</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          {total} missions d&apos;intérim (contrats MIS) postées par des agences concurrentes sur le
          bassin. Plus une cellule est foncée, plus la présence concurrentielle y est forte et
          récente (décroissance sur 60 jours). Une zone claire sur un métier cible = terrain à
          prendre.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_260px] gap-6 items-start">
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs text-muted-foreground px-3 py-2 sticky left-0 bg-card">
                  Commune
                </th>
                {romesAffiches.map((r) => (
                  <th key={r} className="px-1.5 py-2 font-normal align-bottom min-w-[52px]">
                    <span
                      className="block text-[10px] leading-tight text-muted-foreground [writing-mode:vertical-rl] rotate-180 mx-auto h-24"
                      title={libelle(r)}
                    >
                      {libelle(r)}
                    </span>
                    <span className="block text-[10px] font-mono text-muted-foreground mt-1">{r}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {communes.map((commune) => (
                <tr key={commune} className="border-t">
                  <td className="px-3 py-1 text-xs whitespace-nowrap sticky left-0 bg-card">{commune}</td>
                  {romesAffiches.map((rome) => {
                    const cell = cellules.get(`${commune}|${rome}`);
                    const ratio = cell ? cell.intensite / maxIntensite : 0;
                    return (
                      <td key={rome} className="p-0.5">
                        <div
                          className="h-8 rounded-sm flex items-center justify-center font-mono text-[11px] tabular-nums"
                          style={{
                            backgroundColor: cell
                              ? `oklch(0.6 0.14 55 / ${0.12 + ratio * 0.78})`
                              : "transparent",
                            color: ratio > 0.55 ? "white" : "var(--muted-foreground)",
                            border: cell ? "none" : "1px dashed var(--border)",
                          }}
                          title={
                            cell
                              ? `${commune} — ${libelle(rome)} : ${cell.nb} mission(s), intensité ${cell.intensite.toFixed(1)}`
                              : `${commune} — ${libelle(rome)} : aucune mission concurrente`
                          }
                        >
                          {cell ? cell.nb : ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {communes.length === 0 && (
                <tr>
                  <td colSpan={romesAffiches.length + 1} className="px-4 py-10 text-center text-muted-foreground">
                    Aucune mission concurrente en base. Lancez <code className="font-mono">npm run demo</code> ou une
                    ingestion France Travail.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="rounded-lg border bg-card">
          <h2 className="px-4 py-2.5 text-sm font-semibold border-b">Agences présentes</h2>
          <ul className="divide-y">
            {agences.map(([nom, nb]) => (
              <li key={nom} className="px-4 py-2 flex items-center justify-between text-sm">
                <span>{nom}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">{nb} missions</span>
              </li>
            ))}
            {agences.length === 0 && (
              <li className="px-4 py-4 text-sm text-muted-foreground">Aucune agence détectée.</li>
            )}
          </ul>
          <p className="px-4 py-3 border-t text-xs text-muted-foreground">
            Ces missions ne scorent aucune entreprise : elles cartographient où les concurrents
            placent, métier par métier.
          </p>
        </aside>
      </div>
    </div>
  );
}
