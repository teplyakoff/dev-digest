/**
 * tokenizer adapter — token counter for prompt budgeting and attribution.
 *
 * Two callers today:
 *  - the repo-map renderer (T3, `modules/repo-intel/pipeline/repo-map.ts`)
 *    binary-searches the largest set of symbols that fits a token budget; that
 *    loop calls `count()` ≤ ~13 times.
 *  - the review executor (L02) prices each rendered skill block for the run
 *    trace, so "what did this skill cost me" has an answer.
 *
 * Default impl: js-tiktoken `cl100k_base` (pure-JS, no natives). The encoder is
 * lazy-initialised (loading the BPE ranks is the heavy part) and any failure
 * falls back to the `ceil(chars / 4)` heuristic — **`count()` never throws**,
 * which is what lets both callers treat it as reporting rather than as a step
 * that can fail a render or a review.
 *
 * Scope: in-process. Swappable in tests via a mock counter
 * (ContainerOverrides.tokenizer).
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface Tokenizer {
  count(text: string): number;
}

/** Heuristic fallback used before/instead of a real encoder. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TiktokenTokenizer implements Tokenizer {
  private enc?: Tiktoken;
  private broken = false;

  count(text: string): number {
    if (this.broken) return approxTokens(text);
    try {
      this.enc ??= getEncoding('cl100k_base');
      return this.enc.encode(text).length;
    } catch {
      // BPE load failed once — don't retry per call; stick to the heuristic.
      this.broken = true;
      return approxTokens(text);
    }
  }
}
