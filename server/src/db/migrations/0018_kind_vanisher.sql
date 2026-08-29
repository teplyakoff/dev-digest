CREATE TABLE "eval_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"system_prompt_snapshot" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"cases_total" integer DEFAULT 0 NOT NULL,
	"cases_completed" integer DEFAULT 0 NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "eval_run_batches_status_ck" CHECK ("eval_run_batches"."status" in ('running','complete','partial','failed'))
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_run_batches_agent_started_idx" ON "eval_run_batches" USING btree ("agent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_run_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_run_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("workspace_id","owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "eval_cases_source_finding_idx" ON "eval_cases" USING btree ("source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_runs_batch_idx" ON "eval_runs" USING btree ("batch_id");--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_expectation_ck" CHECK ("eval_cases"."expectation" in ('must_find','must_not_flag'));--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_status_ck" CHECK ("eval_runs"."status" in ('passed','failed','errored'));