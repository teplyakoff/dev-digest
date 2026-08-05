/**
 * Rough token estimate for editor and preview headers — chars/4, the same
 * heuristic the server's tokenizer falls back to.
 *
 * Deliberately an estimate: the authoritative per-skill count comes from the run
 * trace, which counts the *rendered* block (name heading and preamble included)
 * with a real encoder. The two will not match exactly, and the trace is the one
 * to quote when the question is "what did this skill cost".
 *
 * Lives here rather than in a route's `_components/` because both the skill
 * editor and the `/skills` preview drawer need it, and they sit at different
 * route levels.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
