CREATE TABLE "score_snapshot" (
	"jour" text NOT NULL,
	"siret" text NOT NULL,
	"strate" double precision NOT NULL,
	"sismo" double precision NOT NULL,
	"tempo" double precision NOT NULL,
	"score_final" double precision NOT NULL,
	"segment" text NOT NULL,
	"top_types" jsonb,
	CONSTRAINT "score_snapshot_jour_siret_pk" PRIMARY KEY("jour","siret")
);
--> statement-breakpoint
CREATE TABLE "score_tempo" (
	"siret" text PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"components" jsonb,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agence" ADD COLUMN "naf_exclus" jsonb;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "motif" text;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "score_final" double precision;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "strate" double precision;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "sismo" double precision;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "tempo" double precision;--> statement-breakpoint
ALTER TABLE "crm_outcome" ADD COLUMN "top_types" jsonb;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "caractere_employeur" text;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "nb_etabs_ouverts" integer;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "ca_annee" integer;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "ca" double precision;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "ca_precedent" double precision;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "resultat_net" double precision;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "resultat_net_precedent" double precision;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "idcc" jsonb;--> statement-breakpoint
ALTER TABLE "entreprise" ADD COLUMN "complements" jsonb;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "tranche_effectif_source" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "code_insee" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "date_debut_activite" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "caractere_employeur" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "enseignes" jsonb;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "nom_commercial" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "idcc" jsonb;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "icpe" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "icpe_regime" text;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "lbb_score" double precision;--> statement-breakpoint
ALTER TABLE "etablissement" ADD COLUMN "lbb_maj" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "tempo" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "proposition_fr" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "fenetre_debut" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "fenetre_fin" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lieu_besoin_fr" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "distance_besoin_km" double precision;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "romes_induits" jsonb;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "code_insee" text;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "date_actualisation" text;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "nb_actualisations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "nombre_postes" integer;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "manque_candidats" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "offre_brute" ADD COLUMN "tranche_effectif_etab" text;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "lieu" jsonb;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "romes" jsonb;--> statement-breakpoint
CREATE INDEX "snapshot_siret_idx" ON "score_snapshot" USING btree ("siret");--> statement-breakpoint
CREATE INDEX "etablissement_insee_idx" ON "etablissement" USING btree ("code_insee");--> statement-breakpoint
CREATE INDEX "signal_siren_idx" ON "signal" USING btree ("siren");