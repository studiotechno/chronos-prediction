import { getResolutions } from "@/lib/queries";
import { validerResolution, rejeterResolution } from "@/app/actions";
import { nafLabel } from "@/lib/reference/naf";
import { dateRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ResolutionPage() {
  const entrees = getResolutions();
  const enAttente = entrees.filter((e) => e.statut === "en_attente");
  const traitees = entrees.filter((e) => e.statut !== "en_attente");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">File de rapprochement</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Signaux dont le rapprochement au SIRET est ambigu (similarité entre 0,62 et 0,88). Valider
          un candidat rattache le signal et relance le scoring immédiatement.
        </p>
      </div>

      {enAttente.length === 0 && (
        <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          File vide — tous les signaux ambigus ont été traités.
        </div>
      )}

      <div className="space-y-4">
        {enAttente.map((e) => (
          <section key={e.id} className="rounded-lg border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm">
                  <span className="text-muted-foreground">Vu chez la source :</span>{" "}
                  <span className="font-semibold">{e.rawDenomination}</span>
                  {e.rawCodePostal && <span className="text-muted-foreground"> · {e.rawCodePostal}</span>}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {e.source.replace("fixture:", "")} · {dateRelative(e.createdAt)}
                </p>
              </div>
              <form action={rejeterResolution}>
                <input type="hidden" name="id" value={e.id} />
                <Button variant="ghost" size="sm" type="submit">
                  Aucun ne correspond
                </Button>
              </form>
            </div>
            <ul className="divide-y">
              {(e.candidats ?? []).map((c) => (
                <li key={c.siret} className="px-4 py-2.5 flex items-center gap-4">
                  <div className="w-24 shrink-0">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", c.similarite >= 0.8 ? "bg-emerald-500" : "bg-sismo")}
                        style={{ width: `${c.similarite * 100}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {(c.similarite * 100).toFixed(0)} % similaire
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.denomination}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {c.commune}
                      {c.naf ? ` · ${nafLabel(c.naf)}` : ""} ·{" "}
                      <span className="font-mono">{c.siret}</span>
                    </p>
                  </div>
                  <form action={validerResolution}>
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="siret" value={c.siret} />
                    <Button size="sm" variant="outline" type="submit">
                      Rattacher
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {traitees.length > 0 && (
        <section className="rounded-lg border bg-card/60">
          <h2 className="px-4 py-2.5 text-sm font-semibold border-b text-muted-foreground">
            Traitées récemment
          </h2>
          <ul className="divide-y">
            {traitees.slice(0, 10).map((e) => (
              <li key={e.id} className="px-4 py-2 flex items-center justify-between text-sm text-muted-foreground">
                <span>{e.rawDenomination}</span>
                <span className="text-xs">
                  {e.statut === "resolu" ? `rattachée → ${e.resolvedSiret}` : "rejetée"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
