/**
 * Limits for the project-context store.
 *
 * These are CONSTANTS, not `platform/config.ts` entries, and the distinction is
 * the onion placement rule rather than taste: `config.ts` reads the environment,
 * and a limit that changes per deployment is a limit nobody can reason about
 * from the code. Every number here is a bound on how much text one repository's
 * store may hold, which is a property of the product, not of the machine.
 *
 * **All four are chosen, not measured** — carried verbatim from SPEC-06's own
 * defaults for an open clarification (`server/docs/specs/06-project-context.md`,
 * *Open questions*). The nearest measured anchors in this repo
 * (`DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500`, the conventions sampler's caps) are
 * about a different volume of text and were not carried across. They live in one
 * file precisely so that measuring the `.md` corpus of two or three real repos
 * and moving them is a one-line change.
 */

/**
 * The largest body one document may hold, in UTF-8 bytes.
 *
 * Bytes, not characters: the same 64 000 in characters would be up to 256 kB of
 * Cyrillic or CJK text, so a character bound is a byte bound that quietly does
 * not hold for most of the world's prose.
 */
export const MAX_DOC_BYTES = 64_000;

/** The largest total one repository's store may hold, in UTF-8 bytes. */
export const MAX_STORE_BYTES = 2_000_000;

/**
 * The most import candidates the picker will list.
 *
 * The cap is applied AFTER an alphabetical sort, so the same first N appear on
 * every rescan and `truncated` says the cap actually bit.
 */
export const MAX_LISTED_DOCS = 500;

/**
 * Attached-context size past which the UI warns — and only warns.
 *
 * It never blocks: a person who has deliberately attached a large specification
 * is not making a mistake the system should refuse, and a warning that blocks is
 * a limit wearing a warning's clothes.
 */
export const WARN_CONTEXT_TOKENS = 20_000;

/** Extensions the import picker offers. Markdown only, by SPEC-06's scope. */
export const CONTEXT_DOC_EXTENSIONS = ['.md'];
