ALTER TABLE "model_calls" ADD COLUMN "billing" text DEFAULT 'metered' NOT NULL;--> statement-breakpoint
CREATE INDEX "model_calls_usage_idx" ON "model_calls" USING btree ("created_at","billing");--> statement-breakpoint
-- Backfill: existing rows default to 'metered', but calls that went through a
-- signed-in Codex/Claude CLI never cost money. The gateway's subscription
-- adapters record provider 'codex_cli'/'claude_cli'; the coding executor
-- records 'cli:<name>'. Left as 'metered' they would read as real spend.
UPDATE "model_calls" SET "billing" = 'subscription'
 WHERE "provider" IN ('codex_cli', 'claude_cli') OR "provider" LIKE 'cli:%';
