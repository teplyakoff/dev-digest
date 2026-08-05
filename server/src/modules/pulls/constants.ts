/** pulls module constants. */

/**
 * How many PRs may have their diff stats backfilled in one list request.
 *
 * Each backfill is a separate GitHub detail fetch, so an unbounded loop would
 * turn the first load of a busy repo into dozens of serial API calls. The
 * periodic refetch picks up whatever is left over.
 */
export const DIFF_STAT_BACKFILL_LIMIT = 10;
