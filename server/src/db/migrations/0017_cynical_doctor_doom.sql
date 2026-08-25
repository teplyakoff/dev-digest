-- L05 PR brief. Every statement below is safe ONLY because `pr_brief` is empty:
-- the table shipped with the starter carrying a single `json` blob and never had
-- a writer (`select count(*) from pr_brief` = 0, checked before generating).
--   * what / why / risk_level / head_sha / provider / model are NOT NULL with no
--     default, which is impossible to add to a populated table;
--   * derived_at's `now()` is a VOLATILE default on an ADD COLUMN NOT NULL, so
--     Postgres rewrites the table — zero rows, zero rewrite;
--   * `json` is NOT dropped. It keeps its NOT NULL and gains a `'{}'` default so
--     an insert that ignores it succeeds; it stays as the starter's extension
--     point, unread by `modules/brief`.
-- pr_brief_risk_level_ck mirrors `BriefRiskLevel` in
-- vendor/shared/contracts/review-api.ts. Change the two together.
ALTER TABLE "pr_brief" ALTER COLUMN "json" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "what" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "why" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risk_level" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "review_focus" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "risks_grounded" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "dropped_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "unavailable_inputs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "derived_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD CONSTRAINT "pr_brief_risk_level_ck" CHECK ("pr_brief"."risk_level" in ('high','medium','low'));