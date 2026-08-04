/**
 * Budgets and allowlists for the Conventions Extractor.
 *
 * Every number here exists to bound ONE model call. The extractor reads a repo
 * it does not control, so "how much of it reaches the prompt" cannot be an
 * emergent property of how large the repo happens to be.
 */

/** How many rank-ordered source files to sample, on top of the configs. */
export const SAMPLE_FILE_COUNT = 12;

/** Per config file. They are small; a 4 kB tsconfig is already unusual. */
export const MAX_CONFIG_BYTES = 4_000;

/**
 * Per sampled source file. The line cap is the one that matters: a convention
 * shows itself in the first screens of a file (imports, exports, the first
 * handler), and the tail is mostly repetition of what the head already proved.
 */
export const MAX_SAMPLE_LINES = 180;
export const MAX_SAMPLE_BYTES = 8_000;

/**
 * The whole prompt's sample budget. When the next file would cross it the
 * sampler STOPS rather than squeezing that file into what is left — half a file
 * is where a model starts citing lines it cannot see.
 */
export const MAX_TOTAL_BYTES = 120_000;

/** Ceiling on what one extraction may propose, before verification. */
export const MAX_CANDIDATES = 20;

/**
 * Longest evidence span a candidate may claim. A rule that needs 40 lines to
 * show itself is not a rule, it is a summary of the file — and a long span makes
 * the "is this really evidence" judgement impossible to make at a glance.
 */
export const MAX_EVIDENCE_SPAN = 12;

/**
 * Config files, grouped by family. Within a family the first present member
 * wins — a repo with both `.eslintrc.json` and `eslint.config.js` is
 * mid-migration, and showing the model both invites a "the project uses two
 * lint configs" non-rule.
 *
 * Looked for at the repo root AND in each package directory (see
 * `MAX_PACKAGE_DIRS`). Root-only was the original rule and it was wrong: the
 * first live run against `teplyakoff/dev-digest` sampled ZERO configs, because
 * that repo is five standalone packages and every `tsconfig.json`,
 * `eslint.config.js` and `package.json` lives one level down. Configs are the
 * most rule-dense input there is, so missing all of them is not a degradation,
 * it is the feature failing quietly.
 */
export const CONFIG_FAMILIES: readonly (readonly string[])[] = [
  ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc'],
  ['tsconfig.json'],
  ['.prettierrc', '.prettierrc.json', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs'],
  ['biome.json', 'biome.jsonc'],
  ['.editorconfig'],
  ['package.json'],
] as const;

/**
 * The only `package.json` keys that reach the prompt. The rest — name, version,
 * the resolved dependency tree — say nothing about how this team writes code,
 * and `dependencies` alone can be tens of kB.
 */
export const PACKAGE_JSON_KEYS = ['scripts', 'dependencies', 'devDependencies'] as const;

/**
 * How many package directories to look for configs in, on top of the root.
 *
 * They are DERIVED from the ranked sample paths' first segments rather than
 * discovered by listing directories: the packages whose code ranks highest are
 * exactly the ones whose conventions matter, the answer costs no extra I/O, and
 * `SourceReader` stays a one-method port instead of growing a directory walk.
 */
export const MAX_PACKAGE_DIRS = 3;

/**
 * Ceiling on config files in one sample. Four families across a root and three
 * packages is otherwise 16 files ahead of any source code, and the configs are
 * supposed to frame the code, not crowd it out.
 */
export const MAX_CONFIG_FILES = 8;

/**
 * This module's OWN default model, used when the workspace has not chosen one.
 *
 * Deliberately not the `conventions` entry in `FEATURE_MODELS`, which names a
 * frontier model: extraction is a bulk read over ~15 files that runs again on
 * every re-scan, so its unconfigured cost has to be small.
 * `settings/feature-models.ts` reserves exactly this path for "callers that keep
 * their own dynamic default (e.g. conventions)".
 */
export const DEFAULT_EXTRACTION_PROVIDER = 'openrouter' as const;
export const DEFAULT_EXTRACTION_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * A ceiling on the answer, not on the reading. 20 candidates of a rule, a path
 * and two integers is a few thousand tokens; anything beyond that is the model
 * writing prose it was told not to write.
 */
export const EXTRACTION_MAX_TOKENS = 4_000;

/**
 * The request is synchronous, so this bound is what stops a hung provider from
 * hanging the HTTP request. `server/INSIGHTS.md` records real 10-minute review
 * calls on openrouter — those are full-diff reviews; this call reads a capped
 * 120 kB and has no business taking minutes.
 */
export const EXTRACTION_TIMEOUT_MS = 90_000;
