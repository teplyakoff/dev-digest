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
 * Config files, grouped by family. Repo root only, first present member of each
 * family wins — a repo with both `.eslintrc.json` and `eslint.config.js` is
 * mid-migration, and showing the model both invites a "the project uses two
 * lint configs" non-rule.
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
