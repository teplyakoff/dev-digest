import type { ConventionCategory } from "@devdigest/shared";

/**
 * The category list, as VALUES.
 *
 * Not imported from the `ConventionCategory` Zod enum on purpose: importing
 * anything from `@devdigest/shared` for a value drags `zod` and the whole
 * contract chain into the shared chunk, measured at ~15 kB First Load JS on
 * EVERY route (see `lib/api.ts` and client/INSIGHTS.md). The type import above
 * is erased at build time and costs nothing.
 *
 * Both drift directions are caught at compile time:
 *  - `satisfies` rejects a key that is not a real category;
 *  - `AllCategoriesCovered` below fails to compile if the contract gains one
 *    that is missing here, which is the direction a `satisfies` alone would let
 *    through silently.
 */
export const CATEGORY_KEYS = [
  "naming",
  "structure",
  "error-handling",
  "typing",
  "testing",
  "api",
  "imports",
  "logging",
  "other",
] as const satisfies readonly ConventionCategory[];

/** Compile-time exhaustiveness: `never` unless every category is listed above. */
type AllCategoriesCovered =
  Exclude<ConventionCategory, (typeof CATEGORY_KEYS)[number]> extends never ? true : never;
/** Referenced so the checker is not elided as an unused type. */
export const CATEGORIES_ARE_EXHAUSTIVE: AllCategoriesCovered = true;

/** Above this the confidence bar reads as "solid", below it as "worth a look". */
export const HIGH_CONFIDENCE = 0.85;

/** Skeleton rows while the first read is in flight. */
export const SKELETON_ROWS = 3;

export const EDIT_MODAL_WIDTH = 620;
