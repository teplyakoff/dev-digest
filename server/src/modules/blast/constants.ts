/**
 * Blast Radius limits and the words it degrades in.
 *
 * The reason strings live here rather than inline for the same reason
 * `smart-diff/constants.ts` holds its patterns: "what do we tell the reviewer
 * when there is no index" is a product decision, and a product decision buried
 * in a service is one nobody finds to argue with.
 */

/**
 * How many changed symbols the response carries.
 *
 * A PR that rewrites a barrel file can declare hundreds, and every one of them
 * costs a caller lookup on the client's render and a row in the MCP tool's
 * text. 50 is "more than any PR a human reviews in one sitting" — the cap is a
 * guard against a pathological diff, not a curation policy.
 *
 * `counts.symbols` on the response is the total BEFORE this cap, so a consumer
 * that compares it against `symbols.length` can say "showing 50 of 63". That
 * sentence is the only thing standing between this cap and a silent
 * truncation, so the two must be computed in that order — the service says so
 * at the slice.
 *
 * Symbols are ordered by caller count DESC before the cut, so what survives is
 * the part of the diff with the widest reach.
 */
export const MAX_SYMBOLS = 50;

/**
 * Depth of the reverse import-graph walk, in hops.
 *
 * Pinned to the same value as `repo-intel`'s `BFS_DEPTH`, and NOT imported from
 * it: `constants.ts` in another module is a sibling import the onion lint lane
 * forbids, and routing it through the container to share one integer would be
 * ceremony. The number is small and the meaning is local — two hops is as far
 * as "this endpoint is downstream of your change" stays a claim a reviewer can
 * check by reading two files.
 */
export const DEPENDENT_DEPTH = 2;

/**
 * Why a map is not `full`, in the reviewer's words rather than the indexer's.
 *
 * These are shown verbatim in the UI and returned verbatim by the MCP tool, so
 * each one has to be a complete sentence that names the remedy. `no_index` in
 * particular must not read as "this PR has no impact" — that is the failure
 * mode the whole three-state contract exists to prevent.
 */
export const BLAST_REASONS = {
  flag_off:
    'Repository intelligence is disabled on this server (REPO_INTEL_ENABLED=false), so no impact map was computed.',
  no_index:
    'This repository has not been indexed yet, so nothing is known about who calls this code. Run Re-analyze on the repository to build the index.',
  index_failed:
    'The last indexing run failed, so the impact map cannot be computed. Re-analyze the repository to try again.',
  partial_index:
    'The index for this repository is incomplete — the indexer stopped before covering every file. Callers and endpoints below are real, but the list may be short.',
  no_symbols:
    'The index covers this repository, but none of the changed files declare a symbol it tracks. This is expected for configuration, documentation and generated files.',
} as const;
