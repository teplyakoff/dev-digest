import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    //
    // FIXED 2026-08-26: this case (and the two below it) originally expected
    // server/docs/api-contracts.md — a path that never existed anywhere in this repo's history.
    // It was copied from evals/README.md's ILLUSTRATIVE example for the `contrast` kind (a
    // teaching placeholder), never checked against the real "Read when" table in root CLAUDE.md.
    // Root CLAUDE.md's actual entry for "API surface or DI wiring" routes to server/README.md —
    // fixed to match. See INSIGHTS.md for the full root-cause writeup.
    name: "API-route task reads server/README.md and pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): "Read when" routing for the review pipeline ---------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc.
    //
    // FIXED 2026-08-26: expected reviewer-core/docs/pipeline.md, which never existed. Root
    // CLAUDE.md's actual "you need the review pipeline" entry routes to reviewer-core/README.md.
    name: "pipeline task follows CLAUDE.md routing to reviewer-core/README.md",
    prompt:
      "Я збираюся змінити review pipeline. Перш ніж торкатися коду — звірся з настановами цього репо " +
      "(CLAUDE.md) щодо того, яку документацію треба прочитати для змін у pipeline, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): the "Session loop" rule, not a dedicated gotchas doc -------------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path, making the negative flaky. As a single-session trace it reliably checks the
  // routing rule instead.
  //
  // FIXED 2026-08-26: expected reviewer-core/insights/gotchas.md — this repo has no such file and
  // CLAUDE.md never names one. The actual home for "what doesn't work" is each package's own
  // INSIGHTS.md, read as part of the "Session loop" rule ("before working in a package, read its
  // INSIGHTS.md"). A real run against this prompt already reads reviewer-core/INSIGHTS.md and
  // quotes its "What Doesn't Work" section verbatim — that IS this repo's gotchas mechanism.
  {
    kind: "trace",
    name: "an unexpected-behavior lookup in reviewer-core reads its INSIGHTS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/INSIGHTS.md"],
    maxTurns: 5,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
