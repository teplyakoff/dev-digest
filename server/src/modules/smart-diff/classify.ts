import type { SmartDiffRole } from '@devdigest/shared';
import { BOILERPLATE_PATTERNS, WIRING_PATTERNS } from './constants.js';

/**
 * Path → role, deterministically and with no I/O.
 *
 * This is the whole "smart" part of Smart Diff: a pure function over a string,
 * so it costs nothing, never calls a model, and is testable without a database,
 * a container or Docker.
 */

/**
 * Classify one changed file's path.
 *
 * EVALUATION ORDER IS BOILERPLATE → WIRING → CORE, AND IT IS LOAD-BEARING.
 *
 * The two lists overlap on purpose, and the overlap resolves by ORDER, not by
 * how specific a pattern looks:
 *
 *   - `package-lock.json` matches boilerplate's lock-file rule. If wiring ran
 *     first, `package.json`'s rule — written loosely by anyone in a hurry —
 *     would claim it, and "a lock-file is ALWAYS boilerplate" is a named
 *     acceptance criterion of this feature.
 *   - `dist/next.config.js` matches BOTH `dist/` (boilerplate) and `*.config.*`
 *     (wiring). Generated wins: a config file that a build emitted is not a
 *     config file a human wrote.
 *
 * Nothing in the type signature protects this. A future edit that reorders these
 * two blocks compiles, passes typecheck, and silently reverses both decisions —
 * which is why the order is pinned by a test (`smart-diff-classify.test.ts`) and
 * not only by this comment.
 *
 * CORE IS THE FALLBACK, not a pattern list. Anything the two lists do not claim
 * is treated as business logic and sorted to the top, so the failure mode of an
 * unknown file type is "a reviewer sees it first", never "a reviewer never sees
 * it". Adding a `CORE_PATTERNS` list would invert that.
 */
export function classifyPath(path: string): SmartDiffRole {
  if (BOILERPLATE_PATTERNS.some((p) => p.test(path))) return 'boilerplate';
  if (WIRING_PATTERNS.some((p) => p.test(path))) return 'wiring';
  return 'core';
}
