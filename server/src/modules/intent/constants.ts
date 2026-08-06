/**
 * Budgets, allowlists and denylists for the Intent classifier.
 *
 * Every number here bounds ONE model call over input the PR AUTHOR controls.
 * "How much of a PR body reaches the prompt" must not be an emergent property of
 * how long the author made it, and "which repo files reach the prompt" must not
 * be an emergent property of what the body asks for.
 *
 * Same shape and the same reasoning as `conventions/constants.ts`.
 */

/**
 * This module's default provider+model, mirroring the `review_intent` entry in
 * `FEATURE_MODELS` — the registry IS the default here, unlike conventions,
 * which deliberately keeps its own cheaper one.
 *
 * MIND THE `-0731` SUFFIX. `deepseek/deepseek-v4-flash` (no suffix) is what the
 * seeded REVIEW agents run. Dropping the suffix would make the classifier and
 * the reviewer the same model, and the feature would quietly stop being a
 * separate cheap pass while still appearing to work. That near-collision is also
 * why every log line labels the call's ROLE rather than just its slug.
 */
export const DEFAULT_INTENT_PROVIDER = 'openrouter' as const;
export const DEFAULT_INTENT_MODEL = 'deepseek/deepseek-v4-flash-0731';

/**
 * PR body cap. Matches `MAX_PR_DESCRIPTION_CHARS` in `reviewer-core/prompt.ts`
 * on purpose: the reviewer and the classifier should be reasoning about the
 * same description, not two different truncations of it.
 */
export const MAX_PR_BODY_CHARS = 4_000;

/** Linked issue: title plus this much body. One issue, never a thread walk. */
export const MAX_ISSUE_BODY_CHARS = 2_000;

/**
 * In-repo plan/spec files named by the PR body. Two is enough to cover
 * "the plan and the spec"; more is a body trying to dump the repo into a prompt.
 */
export const MAX_REPO_FILES = 2;
export const MAX_REPO_FILE_BYTES = 20_000;

/**
 * Hard ceiling on read ATTEMPTS, separate from `MAX_REPO_FILES`.
 *
 * A body listing 500 candidate paths would otherwise cost 500 stats before the
 * second successful read; with this it costs 8. The cap is on attempts because
 * that is what an attacker controls — successes are bounded by the repo.
 */
export const MAX_REPO_READ_ATTEMPTS = 8;

/**
 * Files the classifier may be talked into reading. An ALLOWLIST, because the
 * candidate path comes from attacker-controlled PR text and the clone is the
 * TARGET repo's — the interesting question is not "which files are dangerous"
 * but "which are plausibly a plan document".
 */
export const ALLOWED_DOC_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst'] as const;

/**
 * The layer that actually matters. Without it a PR body reading
 * "see .env for context" puts the target repo's secrets into a model request
 * AND into the persisted run trace, against the repo-wide invariant that
 * secrets never touch the DB or git.
 *
 * `SourceReader.read` already refuses absolute paths, `..` escapes and symlinks
 * out of the clone — but it will happily read `.env` from INSIDE the clone,
 * which is exactly the case this covers.
 */
export const DENIED_PATH_PATTERN = /env|secret|credential|token|key|\.pem/i;

/** Changed files shown to the classifier, as paths + hunk HEADERS only. */
export const MAX_CHANGED_FILES = 60;
export const MAX_HUNK_HEADERS_PER_FILE = 8;

/**
 * Per-item and per-array caps on what the model may claim, applied AFTER the
 * parse (never in the schema — see `pipeline/schema.ts` for what putting a
 * ceiling in the schema did to the conventions extractor).
 *
 * The 80-character item cap is also a mitigation: an instruction laundered
 * through the classifier into `in_scope[]` and onward into the reviewer's prompt
 * does not fit in 80 characters as comfortably as a scope bullet does.
 */
export const MAX_SCOPE_ITEMS = 6;
export const MAX_SCOPE_ITEM_CHARS = 80;

/**
 * Headroom, not a budget — the same lesson `conventions/constants.ts` records.
 * Truncation does not surface as an error; it surfaces as a quieter, worse
 * answer after a silent re-prompt. Output tokens are billed as used.
 */
export const INTENT_MAX_TOKENS = 8_000;

/**
 * 60 s, and it is load-bearing rather than defensive.
 *
 * Derivation runs UPSTREAM of the agent loop, which iterates sequentially
 * (`run-executor.ts`), so a hung classifier delays every queued agent — and
 * `server/INSIGHTS.md` records real 945 s and 674 s provider calls against an
 * 8-99 s norm. Bounded here so the worst case is one lost slot, not a stalled
 * review.
 */
export const INTENT_TIMEOUT_MS = 60_000;

/**
 * Linked-issue reference in a PR body. STRICTER than the GitHub adapter's
 * private regex (`adapters/github/octokit.ts`), which makes the keyword optional
 * and therefore matches any bare `#N` — including "supersedes PR #482" in prose.
 * Two regexes now exist by choice; migrating the adapter onto this one widens
 * the change into the live `PrDetail.linked_issue` path.
 */
export const LINKED_ISSUE_PATTERN = /\b(?:closes|fixes|resolves)\s+#(\d+)\b/i;

/** Any absolute http(s) URL in the body. Recorded, NEVER fetched. */
export const EXTERNAL_URL_PATTERN = /https?:\/\/[^\s)<>"'\]]+/g;

/**
 * Candidate in-repo path named in the body: bare, in backticks, or in a markdown
 * link. Two alternatives, and the second one is not redundant.
 *
 *   1. `docs/plans/x.md` — a slashed path with an extension. The real target.
 *   2. `.env`, `.github/workflows/ci.yml` — anything starting with a DOT
 *      segment, with or without a slash.
 *
 * Alternative 2 exists so the denylist has something to reject. Without it a
 * body reading "see .env for context" matched nothing at all: the file was
 * never read (safe), but it was also never REPORTED, so the card could not say
 * the request had been refused. Matching it and then denying it is what turns
 * silence into a visible `missing_context` line.
 *
 * `\.[A-Za-z]` on the dot form, not `\.[\w.-]`, so a decimal like " .5" in prose
 * is not paraded on the card as a refused file read.
 */
export const REPO_PATH_PATTERN =
  /(?:^|[\s(`[])((?:[\w-][\w.-]*(?:\/[\w.-]+)+\.[A-Za-z]{2,4})|(?:\.[A-Za-z][\w.-]*(?:\/[\w.-]+)*))/g;
