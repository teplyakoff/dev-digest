-- L03 intent layer. Every statement below is safe ONLY because `pr_intent` is
-- empty: `upsertIntent` shipped with the starter and never had a caller
-- (`select count(*) from pr_intent` = 0, checked before generating).
--   * the RENAME loses nothing, so `PrBrief.intent.intent` stops existing;
--   * head_sha / provider / model are NOT NULL with no default, which would
--     otherwise be impossible to add to a populated table;
--   * derived_at's `now()` is a VOLATILE default on an ADD COLUMN NOT NULL, so
--     Postgres rewrites the table — zero rows, zero rewrite.
-- pr_intent_confidence_ck mirrors `IntentConfidence` in
-- vendor/shared/contracts/review-api.ts. Change the two together.
ALTER TABLE "pr_intent" RENAME COLUMN "intent" TO "summary";--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "confidence" text DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "missing_context" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "head_sha" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "derived_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_in" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "tokens_out" integer;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_intent" ADD CONSTRAINT "pr_intent_confidence_ck" CHECK ("pr_intent"."confidence" in ('high','medium','low'));