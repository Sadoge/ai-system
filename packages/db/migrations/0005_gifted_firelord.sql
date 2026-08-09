ALTER TABLE "pipeline_runs" ADD COLUMN "eval_of_run_id" uuid;--> statement-breakpoint
CREATE INDEX "pipeline_runs_eval_idx" ON "pipeline_runs" USING btree ("eval_of_run_id");