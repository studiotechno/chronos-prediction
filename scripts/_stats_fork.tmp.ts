import "./env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db";

async function main() {
  const db = getDb();
  const q = async (label: string, s: string) => {
    const r = await db.execute(sql.raw(s));
    console.log(`\n== ${label}`);
    console.table(r as unknown as Record<string, unknown>[]);
  };
  await q("établissements", `select count(*) as n,
    count(*) filter (where tranche_effectif is not null and tranche_effectif <> 'NN') as tranche_connue,
    count(*) filter (where tranche_effectif_source = 'francetravail') as tranche_ft,
    count(*) filter (where idcc is not null) as avec_idcc,
    count(*) filter (where caractere_employeur is not null) as avec_employeur,
    count(*) filter (where caractere_employeur = 'O') as employeur_o,
    count(*) filter (where enseignes is not null) as avec_enseignes,
    count(*) filter (where code_insee is not null) as avec_insee
    from etablissement`);
  await q("entreprises", `select count(*) as n,
    count(*) filter (where ca is not null) as avec_ca,
    count(*) filter (where ca_precedent is not null) as avec_ca_precedent,
    count(*) filter (where resultat_net is not null) as avec_resultat,
    count(*) filter (where idcc is not null) as avec_idcc,
    count(*) filter (where caractere_employeur is not null) as avec_employeur,
    count(*) filter (where nb_etabs_ouverts is not null) as avec_nb_etabs
    from entreprise`);
  await q("offres", `select count(*) as n,
    count(*) filter (where par_agence_interim = 0) as entreprises,
    count(*) filter (where par_agence_interim = 0 and siret is not null) as entreprises_avec_siret,
    count(*) filter (where date_actualisation is not null) as avec_actualisation,
    count(*) filter (where nb_actualisations >= 1) as actualisees_1,
    count(*) filter (where nb_actualisations >= 2) as actualisees_2,
    count(*) filter (where manque_candidats = 1) as manque_candidats,
    count(*) filter (where nombre_postes > 1) as multipostes,
    count(*) filter (where tranche_effectif_etab is not null) as avec_tranche_etab,
    count(*) filter (where code_insee is not null) as avec_insee,
    count(*) filter (where lat is not null) as geoloc,
    count(*) filter (where payload->>'codeNAF' is null) as sans_naf
    from offre_brute where source not like 'fixture:%'`);
  await q("signaux par type", `select type, source, count(*) as n, count(*) filter (where siret is not null) as rattaches,
    count(*) filter (where lieu is not null) as avec_lieu, count(*) filter (where romes is not null) as avec_romes
    from signal group by 1,2 order by 1,2`);
  await q("résolution", `select source, statut, count(*) from resolution_queue group by 1,2 order by 1,2`);
  await q("runs", `select source, started_at, records_in, records_out, jsonb_array_length(errors) as errs from ingestion_run order by started_at desc limit 8`);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
