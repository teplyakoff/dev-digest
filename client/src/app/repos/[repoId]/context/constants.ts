/**
 * Page-level constants for Project Context.
 *
 * `WARN_CONTEXT_TOKENS` mirrors the server's constant of the same name. The
 * duplication is deliberate and one-directional: the server owns the number,
 * this copy exists so the page can warn without a round-trip, and it warns only
 * — nothing here refuses anything, so the two drifting costs a slightly early or
 * slightly late warning rather than a wrong decision.
 */
export const WARN_CONTEXT_TOKENS = 20_000;

/** How many skeleton rows the list shows while the first fetch is in flight. */
export const SKELETON_ROWS = 4;
