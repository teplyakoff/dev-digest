import { z } from 'zod';
import { Risk, RiskSeverity } from '@devdigest/shared';

/**
 * The model-facing brief schema. Deliberately NOT a shared contract: this is the
 * shape one provider call must produce, and it is strictly narrower than the
 * `PrBriefRecord` that leaves the API (AC-6).
 *
 * WHAT IS MISSING IS THE DESIGN. No `dropped_blocks`, no `unavailable_inputs`,
 * no `attempts`, no provenance of any kind. The server knows every one of those
 * because it did the collecting, the budgeting and the calling — and a model
 * asked to report what it was not shown will describe a plausible gap rather
 * than the real one. Here that answer is not merely unlikely, it is
 * unrepresentable. Same trick as `intent/pipeline/schema.ts`, applied to a
 * different set of server facts.
 *
 * `review_focus[]` has NO line number, and that is a decision, not a gap: an
 * anchor computed against one commit is wrong on the first file that shifts.
 */
export const BriefExtraction = z.object({
  /** What this PR changes. */
  what: z.string(),
  /** Why it changes it. */
  why: z.string(),
  /** The headline. The server keeps this even when every risk is dropped (AC-12). */
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(z.object({ path: z.string(), reason: z.string() })),
});
export type BriefExtraction = z.infer<typeof BriefExtraction>;

/**
 * No `.max()` and no `.min()` anywhere above, and both omissions are
 * load-bearing.
 *
 * `.max()` — `conventions/pipeline/schema.ts` records what a ceiling in the
 * schema cost: a model one item over failed validation, the provider re-prompted
 * with the error, and the model complied by being drastically briefer — 20
 * candidates became 4, at DOUBLE the output tokens. A ceiling is a preference of
 * ours, not a fact about a valid answer, so the service applies it by slicing.
 *
 * `.min(1)` on `Risk.file_refs` — a risk that cites nothing is a real answer
 * shape, and it is rejected by GROUNDING (AC-68), not by the parser. Rejecting
 * it here would turn every uncited risk into a schema-repair round, and NFR-2
 * budgets exactly one of those per build.
 */

/**
 * The `schemaName` this call uses — also the `structuredBySchema` key a test
 * fixture is registered under in `adapters/mocks.ts`.
 */
export const BRIEF_EXTRACTION_SCHEMA_NAME = 'BriefExtraction';
