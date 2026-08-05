/**
 * repo-intel constants — the literals only this feature uses. Phase-tagged:
 * [T1] used now; [T2]/[T3] exported early so the pipeline lands against a single
 * source of truth.
 *
 * Three groups of literals used to live here and no longer do, because they were
 * read from outside this folder and a cross-feature constant import is the
 * coupling onion §11 forbids:
 *
 *   - job kinds        → `platform/job-kinds.ts`   (shared with `repos`)
 *   - walk/parse scope → `platform/source-scope.ts` (shared with the astgrep adapter)
 *
 * Import them from there. Do not re-export them here: two names for one value is
 * how the next reader ends up updating only one of them.
 */

// --- Read-time limits -------------------------------------------------------
/** [T1] Caller fan-out cap per changed symbol (ORDER BY rank DESC LIMIT N). */
export const MAX_CALLERS_PER_SYMBOL = 20;

/**
 * [T1] Bumped whenever the AST extractor or symbol schema changes. A mismatch
 * with `repo_index_state.indexer_version` forces a full reindex.
 *
 * v2 (T3): graph + decl_file resolution + file_rank + repo-map landed, so every
 * T2 `partial` index must be rebuilt to gain the rank-driven data.
 */
export const INDEXER_VERSION = 2;

// --- [T2] Full-index limits (documented now, enforced in the pipeline) ------
export const MAX_INDEXED_FILES = 5000;
export const MAX_FILE_SIZE = 400 * 1024; // 400 KB
export const MAX_PARSE_MS_PER_FILE = 2000;
/** Soft self-watch budget (< JobRunner hard 120s) → finish as `partial`. */
export const INDEX_SOFT_BUDGET_MS = 110_000;

// --- [T3] Graph / hotness / repo-map ---------------------------------------
export const BFS_DEPTH = 2;
export const HOTNESS_WINDOW_DAYS = 180;
export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;
