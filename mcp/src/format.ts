import { wrapUntrusted } from '@devdigest/reviewer-core/prompt.js';

/**
 * Rendering, truncation, and the untrusted-content boundary.
 *
 * ## Why `wrapUntrusted` is here at all
 *
 * `INJECTION_GUARD` (`reviewer-core/src/prompt.ts`) hardens the prompt of the
 * REVIEW model. It does nothing whatsoever for text flowing the other way —
 * out of this server, through MCP, into the model that CALLED the tool. And
 * almost everything this package returns was written by somebody else: finding
 * titles and rationales are LLM output about a stranger's diff, PR titles are
 * the PR author's, convention rules and evidence snippets are read out of a
 * repository nobody here wrote.
 *
 * That makes the caller's model a second, previously unprotected audience.
 * Every such fragment is wrapped, and `wrapUntrusted` already neutralises an
 * attempt to close its own delimiter (`prompt.ts:66-70`).
 *
 * ## Why the import is a sub-path
 *
 * `@devdigest/reviewer-core/prompt.js`, never the barrel: `reviewer-core/src/index.ts`
 * re-exports `OpenRouterProvider`, which drags the `openai` SDK into this
 * package. `prompt.ts` itself imports one TYPE from `@devdigest/shared` plus the
 * pure `./skills.js`. The check is `grep -c openai mcp/package-lock.json` → 0,
 * and `eslint.config.js` fails the build on the barrel import.
 *
 * This is the only thing this package borrows from the engine. It must never
 * grow into prompt assembly or a model call — that would be a review path with
 * no `INJECTION_GUARD` on it.
 */
export { wrapUntrusted };

/**
 * The response ceiling, in CHARACTERS — be honest about the unit. Claude Code
 * truncates tool results at roughly 25 000 **tokens**; characters are what an
 * adapter can count cheaply. At ~4 chars/token this is ~6 000 tokens, well
 * inside that. It is a backstop: `response_format: 'concise'` and `limit` are
 * the real controls.
 */
export const CHARACTER_LIMIT = 25_000;

/**
 * Truncate, and make the message earn its place by naming the exact parameters
 * that would narrow the query. "Output truncated" tells a model nothing it can
 * act on; "pass limit: 20, or severity: 'CRITICAL'" tells it what to do next.
 */
export function applyCharacterLimit(text: string, narrowing: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const kept = text.slice(0, CHARACTER_LIMIT);
  // Cut back to the last newline so a fragment never ends mid-line.
  const lastBreak = kept.lastIndexOf('\n');
  const body = lastBreak > CHARACTER_LIMIT / 2 ? kept.slice(0, lastBreak) : kept;
  return `${body}\n\n[truncated at ${CHARACTER_LIMIT} characters. Narrow the query: ${narrowing}]`;
}

/** Clamp one field so a single 30 KB rationale cannot eat the whole budget. */
export function clamp(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * Wrap a block of externally-authored text. `label` says where it came from, so
 * the reading model can weigh it: `finding`, `pr-title`, `convention-evidence`.
 */
export function untrusted(label: string, text: string): string {
  return wrapUntrusted(label, text);
}

/** `path:12-18`, or `path:12` when the span is one line. */
export function lineRef(file: string, start: number, end: number): string {
  return start === end ? `${file}:${start}` : `${file}:${start}-${end}`;
}

/** A stable "N of M" header so a truncated list never reads like a complete one. */
export function countHeader(shown: number, total: number, noun: string, offset = 0): string {
  if (total === 0) return `No ${noun}.`;
  const from = offset + 1;
  const to = offset + shown;
  return total === shown && offset === 0
    ? `${total} ${noun}.`
    : `${noun}: showing ${from}–${to} of ${total}.`;
}

/** Every tool answers with this shape; failures never throw out of a handler. */
export function textResult(text: string, isError = false): {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
} {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}
