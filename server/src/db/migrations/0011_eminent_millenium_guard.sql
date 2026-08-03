CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_kind_created_idx" ON "reviews" USING btree ("pr_id","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_ws_pr_status_ran_idx" ON "agent_runs" USING btree ("workspace_id","pr_id","status","ran_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_runs_running_idx" ON "agent_runs" USING btree ("pr_id","ran_at" DESC NULLS LAST) WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_severity_ck" CHECK ("findings"."severity" in ('CRITICAL','WARNING','SUGGESTION'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_category_ck" CHECK ("findings"."category" in ('bug','security','perf','style','test'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_kind_ck" CHECK ("findings"."kind" in ('finding','secret_leak','lethal_trifecta','phantom','hook'));--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_confidence_ck" CHECK ("findings"."confidence" >= 0 and "findings"."confidence" <= 1);