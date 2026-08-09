CREATE TABLE "context_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"run_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"section" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"score" numeric(8, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"secret" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"cursor_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "context_grants_run_source_idx" ON "context_grants" USING btree ("run_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "context_grants_source_idx" ON "context_grants" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "context_grants_project_idx" ON "context_grants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_org_idx" ON "webhook_endpoints" USING btree ("organization_id","active");