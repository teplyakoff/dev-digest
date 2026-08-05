/**
 * Source-scope vocabulary — which files this system parses, and how far a
 * signature is trimmed.
 *
 * Shared ACROSS RINGS, not just across features: the astgrep adapter (ring 3)
 * decides whether it can parse a path and trims each declaration head, while the
 * repo-intel walk and pipeline (ring 2) use the same sets to bound the crawl.
 * Before this file the adapter reached into `modules/repo-intel/constants.js` —
 * the dependency arrow backwards (onion §14), and the one violation that makes an
 * adapter impossible to reuse or test outside that feature.
 *
 * Ring 1: imports nothing.
 *
 * `MAX_SIGNATURE_CHARS` in particular has to stay single-sourced. It is applied
 * when a signature is written AND assumed when one is read back, so two copies
 * drifting means truncated signatures that no test would notice.
 */

/** Extensions the extractor understands. Everything else is walked past. */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Directories never walked. `.gitignore` is layered on top of this. */
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

/** Declaration heads are trimmed to this many chars, for cache stability. */
export const MAX_SIGNATURE_CHARS = 120;
