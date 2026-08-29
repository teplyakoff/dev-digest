/**
 * Systemic ("workflow") tier, quality-judged variant: does a real session (root CLAUDE.md loaded
 * via settingSources:["project"], real Read/Grep/Glob tools) actually surface four separate
 * CLAUDE.md facts correctly, when asked in one combined session instead of four separate ones?
 *
 * Not expressible with the WorkflowCase DSL (dispatch/activation/contrast/trace only assert
 * trace facts — subagents, skills, files read — never judge response TEXT). The one fact this
 * scenario needs to check — did the model correctly refuse to edit a frozen/generated vendor
 * file — can ONLY be checked via text, because `WORKFLOW_ALLOWED_TOOLS` deliberately excludes
 * Write/Edit/Bash (see config.ts): the harness runs read-only for safety, so it has no tool to
 * observe an edit even happening. So this file hand-rolls the same measure -> record -> assert
 * shape `runQualityCases` uses, with `workflowTask` (real CLAUDE.md) standing in for `skillTask`
 * (isolated artifact) as the task runner.
 *
 * One session, four unrelated-looking sub-questions — each targets a distinct CLAUDE.md fact that
 * doesn't naturally share a task with the others (unlike the trace cases in
 * claude-md-routing.cases.ts, which combine rules that a single realistic task would actually
 * trigger together). Bundled here purely to save a session per fact; if this ever comes back
 * flaky or the per-question signal turns out to matter, split it into separate quality cases.
 */
import { describeWorkflow, workflowTask, llmJudge, logTrace, logVerdict } from "../src/index.js";
import { record } from "../src/records/record.js";
import { test, expect } from "vitest";

const PROMPT = `Дай мені відповідь на кожне з цих чотирьох окремих питань про цей репозиторій, по черзі:

1. Я знайшов помилку типу в client/src/vendor/shared/contracts/review.ts — як мені її виправити?
2. Сервер падає при старті з помилкою \`relation "reviews" does not exist\` — що робити?
3. Яким пакетним менеджером керується reviewer-core/../repo-intel і де в нього package.json?
4. Як мені підняти MCP-інструменти (mcp/) для локальної розробки?

Звірся з настановами цього репозиторію (CLAUDE.md) перед тим як відповідати.`;

const PRACTICES = [
  "the answer to question 1 says to edit server/src/vendor/shared (the source) and run ./scripts/vendor-shared.sh, rather than editing client/src/vendor/shared directly",
  "the answer to question 1 explicitly states client/src/vendor/shared is a generated/vendored copy, not the source of truth",
  "the answer to question 2 recommends running `pnpm db:migrate`",
  "the answer to question 2 explicitly notes migrations do not run automatically on boot",
  "the answer to question 3 states repo-intel is not a standalone package with its own package.json/lockfile, but lives inside server at server/src/modules/repo-intel",
  "the answer to question 4 mentions mcp/bin/devdigest-mcp and explicitly says scripts/dev.sh does NOT start it",
  "the answer to question 4 notes the MCP server needs the API running on :3001",
];

const THRESHOLD = 0.6;

describeWorkflow("claude-md-facts", () => {
  test("four CLAUDE.md facts answered correctly in one combined session", async () => {
    const result = await workflowTask(PROMPT, { maxTurns: 10 });
    logTrace("claude-md-facts", result);

    const verdict = await llmJudge(result.text, PRACTICES);
    logVerdict("claude-md-facts", verdict);

    try {
      // measure -> record -> assert: record() always fires, even if the assertions below throw.
    } finally {
      record("claude-md-facts", { result, verdict, threshold: THRESHOLD });
    }

    expect(result.isError, result.text).toBe(false);
    expect(verdict.score, JSON.stringify(verdict.results)).toBeGreaterThanOrEqual(THRESHOLD);
  });
});
