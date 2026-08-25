/**
 * The named blocks a brief's input is made of.
 *
 * A NAME PER BLOCK IS LOAD-BEARING, in three places at once. It is the unit the
 * token budget drops (`pipeline/budget.ts`), the string that reaches the user in
 * `dropped_blocks`, and the list `test_brief_prompt_guard` enumerates to prove
 * that no untrusted block escaped its wrapper. Text folded into a message header
 * instead of carried as a block gets none of that: it cannot be dropped, cannot
 * be reported, and is invisible to a guard test that only looks at blocks — which
 * is exactly why the PR title is a block here and not a headline.
 */
export const BRIEF_BLOCK_NAMES = [
  'pr-title',
  'intent',
  'blast-symbols',
  'blast-endpoints',
  'blast-crons',
  'diff-stats',
  'file-stats',
  'context-docs',
  'linked-issue',
] as const;

export type BriefBlockName = (typeof BRIEF_BLOCK_NAMES)[number];

/**
 * Blocks no budget level may ever drop (AC-24): the PR title, the intent summary
 * with its scope lists, and the PATH of every changed file.
 *
 * READ BY A CHECK, NOT BY A READER. `fitToBudget` imports this list and asserts
 * the identity of each entry after every level it applies
 * (`assertUndroppableIntact`), so the guarantee is enforced rather than
 * described. It used to be neither: the list sat here with a comment claiming it
 * stopped a future level being added over one of them, was imported by nothing,
 * and level 5 violated it — a guarantee nothing checks is the same defect as a
 * gate that reports only when it acts.
 *
 * `diff-stats` is deliberately NOT here. No level touches it either, but AC-24
 * does not name it, and a list that mixes "the spec forbids dropping this" with
 * "nothing happens to drop this today" cannot be read as either.
 */
export const UNDROPPABLE_BLOCKS = [
  'pr-title',
  'intent',
  'file-stats',
] as const satisfies readonly BriefBlockName[];

export type UndroppableBlock = (typeof UNDROPPABLE_BLOCKS)[number];

/**
 * The ceiling on ONE brief's assembled system + user messages, in tokens
 * (NFR-1).
 *
 * The unit is the assembled messages, not the blocks: the system prompt, the
 * guard, the wrappers and the block captions weigh as much as the content on a
 * small PR, so a budget measured over blocks alone reports a number that is not
 * the one the provider sees.
 *
 * MEASURED, NOT ASSUMED — 2026-08-25, `pnpm measure:brief` against three real
 * imported PRs of this workspace, twice: once with an empty project-context
 * store, and again with one real 63 kB document (`07-pr-brief.md`, 20 584
 * tokens by the store's own counter) loaded through the L06 API.
 *
 *   PR             collected (no docs)   collected (1 doc)   SENT
 *   dev-digest#3         5 943              26 548          5 943
 *   dev-digest#1         7 172              27 777          7 172
 *   dev-digest#4         1 892              22 497          1 892
 *
 * SENT median 5 943, inside the [4 000; 16 000] band the plan set as its stop
 * condition, so 8 000 stands as NFR-1 specifies it. SENT is the quantity NFR-1
 * norms — the assembled messages that leave the process — and it is what the
 * band is judged on.
 *
 * WHAT THE SECOND MEASUREMENT SETTLED. Budget level 1 is not a safety valve, it
 * is EVERY BUILD: one ordinary spec document is 2.5× this whole budget, so in
 * any repo with a real project-context store the brief is built with no project
 * context at all, and says so in `dropped_blocks`. AC-61 predicted this and the
 * spec's own Open questions carry it; the numbers above are the evidence, not a
 * new claim. Levels 2–6 remain proven by unit test only — once the document is
 * gone the input fits with room to spare, so nothing on real data has yet
 * exercised them.
 *
 * The number is the SPEC's. If a later measurement lands outside the band it
 * goes back to `spec-creator`, and NFR-1 changes — this constant does not get
 * edited to make a failing measurement pass.
 * Re-measure with: `pnpm measure:brief --pr <uuid> --pr <uuid> --pr <uuid>`.
 */
export const BRIEF_TOKEN_BUDGET = 8_000;

/**
 * Budget level 4 (AC-64): callers kept PER SYMBOL, not across the flat list.
 *
 * The distinction is the whole entry: `MAX_CALLERS_PER_SYMBOL` was once
 * documented per-symbol and applied as `slice(0, 20)` over every symbol's
 * callers at once, so a PR touching five symbols rendered some of them with
 * NONE — and "nothing calls this" is exactly the claim a reviewer acts on
 * (`server/INSIGHTS.md`, 2026-08-13).
 */
export const MAX_CALLERS_IN_BRIEF = 5;

/** Budget level 5 (AC-65): the N largest changed files, by `additions + deletions`. */
export const MAX_FILE_STATS_IN_BRIEF = 50;

/**
 * This module's default provider+model, MIRRORING the `risk_brief` entry in
 * `FEATURE_MODELS` (`vendor/shared/contracts/platform.ts`).
 *
 * Mirrored rather than chosen freshly, and that is the trade being made here.
 * The settings page renders the registry entry as "the default", so a module
 * running on something else would make that page state a falsehood — the same
 * class of defect as a contract docstring describing runtime behaviour it does
 * not have (`server/INSIGHTS.md`, 2026-08-12). The cost of mirroring is real:
 * this default needs an OpenAI key, where every other model call in a default
 * install runs on OpenRouter. A workspace that wants the cheap pass sets the
 * `risk_brief` override; changing the built-in means changing BOTH places.
 */
export const DEFAULT_BRIEF_PROVIDER = 'openai' as const;
export const DEFAULT_BRIEF_MODEL = 'gpt-4.1';

/** One brief is one bounded call. Same shape of budget as the classifier's. */
export const BRIEF_MAX_TOKENS = 1_500;
export const BRIEF_TIMEOUT_MS = 60_000;

/**
 * Model round-trips allowed for ONE build (AC-27, NFR-2), passed EXPLICITLY as
 * `maxRetries` on the request.
 *
 * Explicit because the default is not this: `req.maxRetries ?? 2`
 * (`reviewer-core/src/llm/openrouter.ts`) allows up to three requests, and AC-27
 * is only satisfied by a bound that is stated. The cost of the extra round is
 * measured, not hypothetical — one schema-repair on the intent classifier
 * produced 8 378 output tokens at $0.002714 against a budgeted $0.0003
 * (`server/INSIGHTS.md`, 2026-08-06).
 *
 * NOT the HTTP client's transport retries, which sit BELOW the schema layer and
 * are invisible to this feature by design.
 */
export const BRIEF_MAX_SCHEMA_RETRIES = 1;

