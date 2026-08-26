import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (root CLAUDE.md + every
 * package's own AGENTS.md/INSIGHTS.md, loaded via settingSources:["project"]) actually gets
 * followed. Each scenario is deliberately a composite, realistic task so several CLAUDE.md rules
 * get exercised in ONE session instead of raising a separate agent per rule — see the "budget"
 * note below for what that trades away.
 *
 * Budget: 4 Claude sessions total.
 *   - 2 × trace            → 1 session each                       = 2
 *   - 1 × activation pair (positive + near-miss negative)          = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser, no control run — it does
 * NOT prove CLAUDE.md caused the behavior, only that the behavior happened in the real repo).
 * Combining traded away: (a) precise "which specific rule broke" diagnostics — vitest stops at
 * the first failing `expect()` in a trace test, though `logTrace`/`record()` still capture the
 * full trace for manual inspection; (b) a no-CLAUDE.md control run per rule. Use separate
 * `contrast` cases instead when isolating CLAUDE.md's causal contribution actually matters.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): the "Session loop" rule — package INSIGHTS.md + AGENTS.md before work --
  {
    kind: "trace",
    // The endpoint must be genuinely new (not already in routes.ts) or the model reviews existing
    // code instead of reading the package's onboarding docs first — same pitfall documented in
    // review-workflow.cases.ts for the architecture-reviewer dispatch case.
    name: "starting server/ work reads server's AGENTS.md and INSIGHTS.md first",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт у server/: GET /repos/:id/dependency-report " +
      "(віддає збережений звіт dependency-checker для репозиторію). Перш ніж щось проєктувати чи чіпати " +
      "код, зроби те, що цей репозиторій вимагає перед початком роботи в пакеті — і прочитай ці файли.",
    expectFilesRead: ["server/AGENTS.md", "server/INSIGHTS.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): five "Read when" rows at once, via one realistic composite task --------
  {
    kind: "trace",
    // A single natural task ("build a new review agent end-to-end") legitimately touches all five
    // "Read when" rows in root CLAUDE.md: the pipeline (reviewer-core/README.md), the API/DI surface
    // (server/README.md), tests (TESTING.md), the agent's own system prompt
    // (docs/agent-prompts/README.md), and packaging it as a Claude Code subagent (.claude/agents/README.md).
    name: "building a new review agent end-to-end touches every 'Read when' doc",
    prompt:
      "Я хочу з нуля спроєктувати новий review-агент 'dependency-drift-reviewer', який матиме доступ до " +
      "review pipeline і API-шару сервера. Перед тим як щось писати, звірся з усіма відповідними " +
      "настановами цього репо: як влаштований review pipeline, який API-surface і DI в server/, як " +
      "писати тести для цього, як писати системний промпт для агента-рев'юера, і як оформити такого " +
      "агента як Claude Code subagent. Прочитай кожен профільний документ, який репо для цього вказує.",
    expectFilesRead: [
      "reviewer-core/README.md",
      "server/README.md",
      "TESTING.md",
      "docs/agent-prompts/README.md",
      ".claude/agents/README.md",
    ],
    maxTurns: 10,
  },

  // --- activation pair (2 sessions): pr-self-review must NOT auto-fire on a bare push request -----
  // Its own SKILL.md is explicit: "ON DEMAND ONLY... Do NOT trigger it automatically from `git
  // push`... nothing is lost by not auto-running: `.claude/hooks/pr-guard.sh` reads the stored
  // verdict independently." Root CLAUDE.md's "run /pr-self-review before a PR" is a rule for the
  // USER/session to follow, enforced by the hook — not an instruction for Claude to self-dispatch
  // the skill unprompted. So the correct behavior is the opposite of what a shallow reading of
  // CLAUDE.md alone would suggest — this pair checks Claude gets that nuance right both ways.
  {
    kind: "activation",
    name: "pr-self-review activates when explicitly asked before a PR",
    prompt:
      "Я щойно закінчив правити код у server/. Перш ніж я відкрию pull request, прогони самоперевірку " +
      "цієї зміни за процесом цього репозиторію.",
    skill: "pr-self-review",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — a bare commit-and-push request must NOT auto-fire pr-self-review",
    prompt: "Закомить і запуш поточні зміни в server/.",
    skill: "pr-self-review",
    shouldActivate: false,
    maxTurns: 4,
  },
];
