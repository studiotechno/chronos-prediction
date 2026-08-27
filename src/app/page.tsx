import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  const db = getDb();
  const leads = db.select().from(schema.lead).all();

  if (leads.length === 0) {
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
    <div>
      <h1 className="text-lg font-semibold mb-4">Leads de la semaine</h1>
      <p className="text-sm text-muted-foreground">{leads.length} leads — tableau en phase 4.</p>
    </div>
  );
}
