CREATE TABLE "agence" (
	"id" text PRIMARY KEY NOT NULL,
	"nom" text NOT NULL,
	"responsable" text,
	"email" text,
	"commune" text,
	"code_postal" text,
	"departement" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"rayon_km" double precision NOT NULL,
	"naf_cibles" jsonb,
	"rome_cibles" jsonb,
	"cree_le" text
);
--> statement-breakpoint
CREATE TABLE "crm_outcome" (
	"id" text PRIMARY KEY NOT NULL,
	"siret" text NOT NULL,
	"evenement" text NOT NULL,
	"date" text NOT NULL,
	"montant" double precision
);
--> statement-breakpoint
CREATE TABLE "entreprise" (
	"siren" text PRIMARY KEY NOT NULL,
	"denomination" text NOT NULL,
	"categorie" text,
	"date_creation" text,
	"etat" text
);
--> statement-breakpoint
CREATE TABLE "etablissement" (
	"siret" text PRIMARY KEY NOT NULL,
	"siren" text NOT NULL,
	"denomination" text NOT NULL,
	"naf" text NOT NULL,
	"tranche_effectif" text,
	"effectif_estime" integer,
	"code_postal" text,
	"commune" text,
	"lat" double precision,
	"lon" double precision,
	"date_creation" text,
	"etat_administratif" text,
	"est_siege" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text,
	"records_in" integer DEFAULT 0 NOT NULL,
	"records_out" integer DEFAULT 0 NOT NULL,
	"errors" jsonb
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"siret" text PRIMARY KEY NOT NULL,
	"score_final" double precision NOT NULL,
	"strate" double precision NOT NULL,
	"sismo" double precision NOT NULL,
	"statut" text DEFAULT 'nouveau' NOT NULL,
	"segment" text DEFAULT 'chaud' NOT NULL,
	"raison_fr" text NOT NULL,
	"top_signals" jsonb,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offre_brute" (
	"id" text PRIMARY KEY NOT NULL,
	"siret" text,
	"entreprise_nom" text,
	"intitule" text NOT NULL,
	"type_contrat" text,
	"duree_contrat_jours" integer,
	"rome" text,
	"code_postal" text,
	"commune" text,
	"par_agence_interim" integer DEFAULT 0 NOT NULL,
	"date_publication" text NOT NULL,
	"first_seen_at" text NOT NULL,
	"last_seen_at" text NOT NULL,
	"closed_at" text,
	"source" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "resolution_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"raw_denomination" text NOT NULL,
	"raw_code_postal" text,
	"raw_naf" text,
	"candidats" jsonb,
	"statut" text DEFAULT 'en_attente' NOT NULL,
	"resolved_siret" text,
	"signal_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_sismo" (
	"siret" text PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"components" jsonb,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_strate" (
	"siret" text PRIMARY KEY NOT NULL,
	"score" double precision NOT NULL,
	"components" jsonb,
	"computed_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" text PRIMARY KEY NOT NULL,
	"siret" text,
	"siren" text,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" text NOT NULL,
	"ingested_at" text NOT NULL,
	"confidence" double precision NOT NULL,
	"payload" jsonb,
	"raw_ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weights" (
	"key" text PRIMARY KEY NOT NULL,
	"value" double precision NOT NULL,
	"min" double precision NOT NULL,
	"max" double precision NOT NULL,
	"label_fr" text NOT NULL,
	"description_fr" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "etablissement" ADD CONSTRAINT "etablissement_siren_entreprise_siren_fk" FOREIGN KEY ("siren") REFERENCES "public"."entreprise"("siren") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "etablissement_siren_idx" ON "etablissement" USING btree ("siren");--> statement-breakpoint
CREATE INDEX "etablissement_naf_idx" ON "etablissement" USING btree ("naf");--> statement-breakpoint
CREATE INDEX "etablissement_cp_idx" ON "etablissement" USING btree ("code_postal");--> statement-breakpoint
CREATE INDEX "lead_segment_idx" ON "lead" USING btree ("segment");--> statement-breakpoint
CREATE INDEX "offre_siret_idx" ON "offre_brute" USING btree ("siret");--> statement-breakpoint
CREATE INDEX "offre_intitule_idx" ON "offre_brute" USING btree ("intitule");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_source_rawref_uq" ON "signal" USING btree ("source","raw_ref");--> statement-breakpoint
CREATE INDEX "signal_siret_idx" ON "signal" USING btree ("siret");--> statement-breakpoint
CREATE INDEX "signal_type_idx" ON "signal" USING btree ("type");