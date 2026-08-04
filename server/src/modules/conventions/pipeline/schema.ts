import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';
import { MAX_CANDIDATES } from '../constants.js';

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

export const ConventionExtraction = z.object({
  candidates: z.array(ExtractedConvention).max(MAX_CANDIDATES),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;

/**
 * The `schemaName` this call uses. Named to match what `adapters/mocks.ts`
 * already documents for `structuredBySchema`, so a fixture keyed on it works
 * without the mock changing.
 */
export const CONVENTION_EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';
