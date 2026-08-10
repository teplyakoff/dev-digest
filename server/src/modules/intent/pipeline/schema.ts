import { Intent, IntentConfidence } from '@devdigest/shared';

/**
 * The model-facing classification schema. Deliberately NOT a shared contract:
 * this is the shape one provider call must produce, and it is strictly narrower
 * than the `PrIntentRecord` that leaves the API.
 *
 * The difference is the whole design. There is **no `sources` field and no
 * `missing_context` field**. The server knows exactly what it collected and what
 * it failed to collect, because it did the collecting — asking the model to
 * report its own provenance invites it to invent a source that sounds right. A
 * hallucinated source is therefore not merely unlikely here: the schema gives it
 * nowhere to go. That is `conventions/pipeline/schema.ts`'s "no snippet field"
 * trick, applied to provenance instead of evidence.
 *
 * `confidence` IS the model's to report, and it is bounded in what it can do:
 * downstream it can only DISARM the scope filter, never arm it (`service.ts`).
 */
export const IntentExtraction = Intent.extend({ confidence: IntentConfidence });
export type IntentExtraction = typeof IntentExtraction._type;

/**
 * No `.max()` on the arrays, and the omission is load-bearing.
 *
 * `conventions/pipeline/schema.ts` records what happened when a ceiling went in
 * the schema instead of after the parse: a model one over the limit failed
 * validation, the provider re-prompted with the error, and the model complied by
 * being drastically briefer — 20 candidates became 4, at DOUBLE the output
 * tokens. A ceiling is a preference of ours, not a fact about a valid answer.
 * `service.ts` applies it by slicing.
 */

/**
 * The `schemaName` this call uses — also the `structuredBySchema` key a test
 * fixture is registered under in `adapters/mocks.ts`.
 */
export const INTENT_EXTRACTION_SCHEMA_NAME = 'IntentExtraction';
