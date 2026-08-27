import Link from "next/link";
import { getLeads, type FiltresLeads } from "@/lib/queries";
import { loadDaresTable } from "@/lib/reference/dares";
import { nafLabel } from "@/lib/reference/naf";
import { ScoreDual, LegendeScores } from "@/components/score-dual";
import { SignalBadges } from "@/components/signal-badges";
import { LeadsFiltres } from "@/components/leads-filtres";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const STATUT_LABELS: Record<string, string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  qualifie: "Qualifié",
  perdu: "Perdu",
  gagne: "Gagné",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filtres: FiltresLeads = {
    naf: typeof sp.naf === "string" ? sp.naf : undefined,
    type: typeof sp.type === "string" ? sp.type : undefined,
    dmax: typeof sp.dmax === "string" ? Number(sp.dmax) : undefined,
    smin: typeof sp.smin === "string" ? Number(sp.smin) : undefined,
  };
  const { chauds, nurturing } = getLeads(filtres);

  const dares = loadDaresTable();
  const divisionsPresentes = [
    ...new Set([...chauds, ...nurturing].map((l) => l.naf.replace(/[^0-9]/g, "").slice(0, 2))),
  ].sort();
  const nafDivisions = divisionsPresentes.map((code) => ({
    code,
    label: dares.get(code)?.libelle ?? `Division ${code}`,
  }));

  if (chauds.length === 0 && nurturing.length === 0 && !Object.values(filtres).some((v) => v != null)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-2">
        <h1 className="text-lg font-semibold">Aucun lead calculé</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Lancez <code className="font-mono bg-muted px-1 rounded">npm run demo</code> pour charger
          les données de démonstration et calculer les scores, ou{" "}
          <code className="font-mono bg-muted px-1 rounded">npm run score</code> si les données sont
          déjà ingérées.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads de la semaine</h1>
          <p className="text-sm text-muted-foreground">
            {chauds.length} leads chauds · {nurturing.length} en nurturing
          </p>
        </div>
        <LegendeScores />
      </div>

      <LeadsFiltres nafDivisions={nafDivisions} />

      {/* ------------------------------------------------ Leads chauds */}
      <section className="rounded-lg border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-sismo-soft/40 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-sismo" />
          <h2 className="text-sm font-semibold">Leads chauds</h2>
          <span className="text-xs text-muted-foreground">déclencheurs récents — à appeler en priorité</span>
        </div>
        <div className="overflow-x-auto">
          <Table className="table-fixed min-w-[1000px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28">Score</TableHead>
                <TableHead className="w-[230px]">Entreprise</TableHead>
                <TableHead>Pourquoi appeler</TableHead>
                <TableHead className="w-[190px]">Signaux</TableHead>
                <TableHead className="text-right w-16">Dist.</TableHead>
                <TableHead className="w-20">Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chauds.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                    Aucun lead chaud ne correspond aux filtres.
                  </TableCell>
                </TableRow>
              )}
              {chauds.map((l) => (
                <TableRow key={l.siret} className="align-top">
                  <TableCell>
                    <ScoreDual final={l.scoreFinal} strate={l.strate} sismo={l.sismo} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Link
                      href={`/lead/${l.siret}`}
                      className="font-medium hover:underline underline-offset-2"
                    >
                      {l.denomination}
                    </Link>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {l.commune} · {nafLabel(l.naf)}
                      {l.effectifEstime ? ` · ≈ ${l.effectifEstime} sal.` : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-foreground/85 whitespace-normal">
                    <span className="line-clamp-2">{l.raisonFr}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SignalBadges topSignals={l.topSignals} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {l.distanceKm != null ? `${l.distanceKm.toLocaleString("fr-FR")} km` : "—"}
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{STATUT_LABELS[l.statut] ?? l.statut}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ------------------------------------------------ Nurturing */}
      <section className="rounded-lg border bg-card/60 overflow-hidden">
        <div className="px-4 py-2.5 border-b flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-strate" />
          <h2 className="text-sm font-semibold text-muted-foreground">Nurturing</h2>
          <span className="text-xs text-muted-foreground">
            bon profil structurel, pas de déclencheur assez récent — hors du flux principal
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table className="table-fixed min-w-[900px]">
            <TableBody>
              {nurturing.length === 0 && (
                <TableRow>
                  <TableCell className="text-center text-sm text-muted-foreground py-6">
                    Rien en nurturing avec ces filtres.
                  </TableCell>
                </TableRow>
              )}
              {nurturing.map((l) => (
                <TableRow key={l.siret} className="text-muted-foreground">
                  <TableCell className="w-28">
                    <ScoreDual final={l.scoreFinal} strate={l.strate} sismo={l.sismo} className="opacity-70" />
                  </TableCell>
                  <TableCell className="w-[340px] whitespace-normal">
                    <Link href={`/lead/${l.siret}`} className="font-medium text-foreground/70 hover:underline underline-offset-2">
                      {l.denomination}
                    </Link>
                    <span className="text-xs ml-2">
                      {l.commune} · {nafLabel(l.naf)}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs whitespace-normal">
                    <span className="line-clamp-1">{l.raisonFr}</span>
                  </TableCell>
                  <TableCell className="text-right w-20 font-mono text-xs tabular-nums">
                    {l.distanceKm != null ? `${l.distanceKm.toLocaleString("fr-FR")} km` : "—"}
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
