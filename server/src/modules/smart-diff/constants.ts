/**
 * Smart Diff thresholds and path patterns.
 *
 * Everything the classifier decides with lives here, in one file, because the
 * decisions are *policy* and policy gets argued about: "is a README boilerplate"
 * is a product question, not a code question, and it should be answerable by
 * reading one list rather than by tracing a function.
 *
 * PLAIN REGEXES ONLY — no glob library. A path matcher is not worth a new
 * runtime dependency on the server, and `pnpm lint` would not catch one being
 * added. The patterns are tested against the WHOLE path (`server/dist/index.js`,
 * not `index.js`), so every directory rule is written `(^|\/)dir\//` and matches
 * at any depth rather than only at the root.
 */

import type { Severity, SmartDiffRole } from '@devdigest/shared';

/**
 * Generated / mechanical output — "skim, or don't read at all".
 *
 * Checked FIRST (see `classify.ts`), which is what lets these be written as the
 * broad rules they are: `package-lock.json` reaches this list before
 * `package.json` can pull it into wiring.
 */
export const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /**
   * Lock-files, by EXTENSION rather than by a list of three JavaScript
   * filenames. The classifier runs on imported PRs from arbitrary repos, so
   * `Cargo.lock`, `Gemfile.lock`, `poetry.lock` and `composer.lock` are the same
   * artifact wearing another ecosystem's name and must land in the same group.
   */
  /\.lock$/,
  /**
   * The lock-files that do NOT end in `.lock`, matched on their exact basename.
   *
   * This is the single most fragile line in the file: `package-lock.json` is a
   * named acceptance criterion, and any rule loose enough to be written
   * `includes('package.json')` captures it into wiring instead. The `$` and the
   * `(^|\/)` are both load-bearing.
   */
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|bun\.lockb)$/,
  /**
   * Build output and tool caches, at any depth — `server/dist/index.js` is as
   * generated as `dist/index.js`, and anchoring to the start of the path would
   * pass the second and miss the first in a monorepo, which is every repo this
   * feature is interesting on.
   */
  /(^|\/)(dist|build|coverage|node_modules|\.next)\//,
  /**
   * Vendored copies. `client/src/vendor/shared/**` in this very repo is a
   * generated copy of the server's contracts that the repo forbids editing — a
   * `.ts` file under `src/` that a naive "source file = core" rule would put at
   * the top of the review. Whatever a `vendor/` directory holds, its diff was
   * produced by a script somewhere else.
   */
  /(^|\/)vendor\//,
  /** Snapshot fixtures: written by the test runner, reviewed by nobody. */
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /**
   * Minified bundles and source maps. Reading a `.map` diff is not a thing a
   * human does; it exists so a debugger can undo the minification.
   */
  /\.min\.(js|css)$/,
  /\.map$/,
  /**
   * Binary and near-binary assets. There is no line-level review to be had —
   * the diff is either "changed" or "not changed" — so they belong wherever the
   * reviewer looks last.
   */
  /\.(png|jpe?g|gif|bmp|ico|webp|avif|svg|pdf|zip|gz|tgz|tar|jar|wasm|woff2?|ttf|eot|otf|mp4|mov|webm|mp3|wav)$/i,
];

/**
 * Configuration, plumbing and prose — "read it, but it is not the change".
 *
 * Checked SECOND. Everything here is hand-written and worth a reviewer's eyes;
 * what it is not is the business logic the PR exists to change.
 */
export const WIRING_PATTERNS: readonly RegExp[] = [
  /**
   * `*.config.*` — `vitest.config.ts`, `next.config.mjs`, `eslint.config.mjs`.
   * The dots on BOTH sides are deliberate: a module named `src/config.ts` is
   * someone's actual configuration code and stays core.
   */
  /(^|\/)[^/]*\.config\.[^/]+$/,
  /** `tsconfig.json`, `tsconfig.build.json`, … */
  /(^|\/)tsconfig[^/]*\.json$/,
  /**
   * `package.json` — and ONLY `package.json`. Its lock-file was already claimed
   * by the boilerplate list above; that ordering is the whole reason this
   * pattern is allowed to be this simple.
   */
  /(^|\/)package\.json$/,
  /**
   * Barrels and transport. `index.ts` re-exports and `routes.ts` register — both
   * are how the pieces are connected, not what the pieces do. Classifying
   * `routes.ts` as wiring is a judgement call worth naming: a route handler in
   * this codebase parses, delegates and maps a status code, so the logic a
   * reviewer is looking for is in the `service.ts` next door.
   */
  /(^|\/)index\.tsx?$/,
  /(^|\/)routes\.ts$/,
  /** Schema migrations: generated SQL, but reviewed like a deploy step. */
  /(^|\/)migrations\//,
  /** Ambient type declarations — shape, never behaviour. */
  /\.d\.ts$/,
  /** CI, containers and repo scripts. */
  /(^|\/)\.github\/workflows\//,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*$/,
  /(^|\/)scripts\//,
  /**
   * Markdown — WIRING, and deliberately not boilerplate.
   *
   * `boilerplate` means "generated / mechanical — skim", and hand-written prose
   * is neither. The asymmetry settles it: calling a README `wiring` costs one
   * slot of ordering, while calling a system prompt (`docs/agent-prompts/**`) or
   * an ADR `boilerplate` COLLAPSES it by default and the reviewer never opens
   * it. `wiring` still sorts below `core`, so "business logic first" holds
   * either way.
   *
   * Still open (see `docs/plans/L03-smart-diff.md`, Open decisions): whether
   * `docs/agent-prompts/**` and `.claude/skills/**` should be promoted to
   * `core`, since in THIS repo those files are behaviour. Deciding that needs a
   * product call about whether the classifier is generic or repo-aware; it is
   * two lines here when it comes.
   */
  /\.mdx?$/,
];

/**
 * Changed lines (`additions + deletions`) above which ONE file is flagged large.
 *
 * 200, taken from the one in-repo precedent for "a file this size behaves
 * differently to the reader": `AUTO_EXPAND_MAX_LINES = 200` in
 * `client/src/components/diff-viewer/constants.ts:4`, which is the point the
 * diff viewer already stops auto-expanding a file. Matching it means the
 * highlight chip appears exactly on the files the viewer had already decided
 * were too big to open unasked, rather than on a second, differently-drawn line.
 *
 * No measurement was taken for this feature and none is claimed. If the viewer's
 * threshold moves, this one should move with it — they are the same judgement.
 */
export const LARGE_FILE_LINES = 200;

/**
 * Total changed lines above which the whole PR is flagged as "consider
 * splitting".
 *
 * PROVISIONAL. Unlike `LARGE_FILE_LINES` this number has NO in-repo precedent
 * and no measurement behind it: 500 is "more than a couple of large files"
 * (`LARGE_FILE_LINES` is 200) and nothing stronger. It is recorded as an open
 * decision in `docs/plans/L03-smart-diff.md`, and what would settle it is the
 * changed-line distribution across a handful of genuinely imported PRs, or the
 * course author's number.
 *
 * The blast radius of being wrong is one banner, and the banner's body is not
 * rendered while `proposed_splits` is empty — so an over-eager threshold is
 * noise, not a broken feature. Do not "confirm" this value without measuring;
 * delete this paragraph when someone does.
 */
export const SPLIT_TOO_BIG_LINES = 500;

/**
 * The order groups are emitted in, and the feature's entire promise: business
 * logic before plumbing before generated files. Read by the service when it
 * builds the response and by the classifier's tests.
 */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Severity, as a sortable number — lower is worse, so a plain `a - b` puts the
 * most severe file first.
 *
 * It lives here rather than inside the service's comparator for the same reason
 * the patterns do: "is a WARNING ranked above a SUGGESTION" is a decision, and a
 * decision hidden in a comparator is a decision nobody will find. The members
 * are the `Severity` enum's (`vendor/shared/contracts/findings.ts`), which the
 * `findings_severity_ck` CHECK constraint in migration 0011 pins in the database
 * as well.
 *
 * KEYED BY `Severity`, NOT BY `string`. It used to be keyed by `string` on the
 * grounds that the value arrives from a `text` column — true, but the column is
 * not where the risk is. The map is now exhaustive by construction: adding a
 * member to the enum stops this file compiling until the new severity is given a
 * rank, which is the only moment anyone will think about WHERE it ranks. Keyed
 * by `string` it compiled silently and the caller's `?? Infinity` sorted the
 * newcomer last — harmless for a severity below `SUGGESTION`, exactly backwards
 * for one added above `CRITICAL`. The three edit sites stay in step for the same
 * reason they always did: this map, the enum, and the `findings_severity_ck`
 * CHECK in migration 0011.
 *
 * The raw `text` value is still narrowed exactly once, at the join in
 * `service.ts`, where the comment records why that narrowing holds.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
