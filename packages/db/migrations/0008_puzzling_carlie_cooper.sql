CREATE TABLE "eval_suite_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"suite_name" text NOT NULL,
	"source_run_id" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eval_suite_members" ADD CONSTRAINT "eval_suite_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_suite_members" ADD CONSTRAINT "eval_suite_members_source_run_id_pipeline_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_suite_members_unique_idx" ON "eval_suite_members" USING btree ("organization_id","suite_name","source_run_id");--> statement-breakpoint
CREATE INDEX "eval_suite_members_suite_idx" ON "eval_suite_members" USING btree ("organization_id","suite_name");