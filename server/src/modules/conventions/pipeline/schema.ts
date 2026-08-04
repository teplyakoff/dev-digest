import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';

/**
 * The model-facing extraction schema. Deliberately NOT a shared contract: this
 * is the shape one provider call must produce, and it is narrower than the
 * `ConventionCandidate` that leaves the API.
 *
 * The difference is the point of the whole feature. There is **no snippet
 * field**. The model returns a path and a line span; the server slices those
 * lines out of the text it sent and stores what it read. A hallucinated snippet
 * is therefore not unlikely — the schema gives it nowhere to go.
 */
export const ExtractedConvention = z.object({
  category: ConventionCategory,
  /**
   * One rule, phrased as an instruction a reviewer could act on. Bounded at both
   * ends: under ~10 characters is a label ("naming"), over 200 is a paragraph
   * that will read as a summary of the file rather than as a rule.
   */
  rule: z.string().min(10).max(200),
  evidence_path: z.string().min(1),
  evidence_start_line: z.number().int().positive(),
  evidence_end_line: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

/**
 * No `.max()` here on purpose, and the omission is load-bearing.
 *
 * It used to be `.max(MAX_CANDIDATES)`, which turned "slightly too many" into
 * "far too few": a model that answered with 22 candidates failed schema
 * validation outright, the provider re-prompted with the error, and the model
 * complied by being drastically briefer. One live scan went 20 candidates → 4
 * that way, at DOUBLE the output tokens — more work, less result, and no error
 * anywhere to say so.
 *
 * A ceiling is a preference of ours, not a fact about a valid answer. It is
 * applied by slicing after the parse (`service.ts`), where being over it costs
 * nothing.
 */
export const ConventionExtraction = z.object({
  candidates: z.array(ExtractedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/**
 * The `schemaName` this call uses. Named to match what `adapters/mocks.ts`
 * already documents for `structuredBySchema`, so a fixture keyed on it works
 * without the mock changing.
 */
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';
