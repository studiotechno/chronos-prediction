import { getIngestion } from "@/lib/queries";
import { SOURCES } from "@/lib/ingest/registry";
import { heureCourte, dateRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const ETAT_BADGE: Record<string, { label: string; classe: string }> = {
  verifie: { label: "Endpoint vérifié", classe: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900" },
  non_verifie: { label: "Non vérifié — fixtures seulement", classe: "bg-sismo-soft text-sismo border-sismo/30" },
  embarquee: { label: "Embarquée dans le repo", classe: "bg-strate-soft text-strate border-strate/30" },
};

export default function IngestionPage() {
  const runs = getIngestion();
  const dernierParSource = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const cle = r.source.replace("fixture:", "");
    if (!dernierParSource.has(cle)) dernierParSource.set(cle, r);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">État des sources</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Chaque source est un adapter derrière une interface commune. L&apos;état de vérification
          des endpoints est documenté dans <code className="font-mono text-xs">docs/sources.md</code>.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {SOURCES.map((s) => {
          const badge = ETAT_BADGE[s.etatEndpoint];
          const dernier = dernierParSource.get(s.id);
          return (
            <section key={s.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">{s.nomFr}</h2>
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", badge.classe)}>
                  {badge.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{s.descriptionFr}</p>
              {s.notesFr && <p className="text-xs text-sismo leading-relaxed">{s.notesFr}</p>}
              <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                <span>{s.sansCle ? "Sans clé d'API" : "Clé requise"}</span>
                {dernier && (
                  <span>
                    · Dernière exécution {dateRelative(dernier.startedAt)}
                    {dernier.source.startsWith("fixture:") ? " (fixtures)" : ""}
                  </span>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-lg border bg-card overflow-hidden">
        <h2 className="px-4 py-2.5 text-sm font-semibold border-b">Exécutions récentes</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Source</TableHead>
                <TableHead>Début</TableHead>
                <TableHead className="text-right">Lus</TableHead>
                <TableHead className="text-right">Retenus</TableHead>
                <TableHead className="text-right">Erreurs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                    Aucune exécution enregistrée.
                  </TableCell>
                </TableRow>
              )}
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">
                    {r.source.replace("fixture:", "")}
                    {r.source.startsWith("fixture:") && (
                      <span className="ml-1.5 text-[11px] text-sismo">(fixtures)</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {heureCourte(r.startedAt)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{r.recordsIn}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{r.recordsOut}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      (r.errors?.length ?? 0) > 0 ? "text-risque font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {r.errors?.length ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
