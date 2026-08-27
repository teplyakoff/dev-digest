/* helpers.ts — pure logic for EvalCaseEditor.

   Nothing here imports a Zod schema as a VALUE. The expected-output badge is
   `JSON.parse` in a try/catch, not `EvalCaseRecord.safeParse`: a schema import
   drags `zod` into First Load JS on every route that renders this modal, which
   measured at ~15 kB (`client/INSIGHTS.md`, NFR-11). Contract types are
   type-only imports and erase at build time. */

import type { EvalExpectation } from "@devdigest/shared";

/** What the expected-output box currently holds. `ok: false` flips the badge. */
export type ParsedExpectation =
  | { ok: true; value: unknown }
  | { ok: false; value: undefined };

/**
 * AC-99: the validity badge is a `JSON.parse` result, nothing more.
 *
 * An EMPTY box parses as the empty array rather than failing — a `must_not_flag`
 * case's expected output is `[]` (server AC-21), so "I expect nothing here" must
 * not be reported as invalid JSON.
 */
export function parseExpected(text: string): ParsedExpectation {
  if (text.trim() === "") return { ok: true, value: [] };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, value: undefined };
  }
}

/**
 * The case's direction, DERIVED from the expected output rather than stored in
 * a second control that could contradict it (`react-best-practices` — Derive,
 * Don't Store).
 *
 * The two are the same fact on the server: a `must_find` case expects at least
 * one finding (AC-20) and a `must_not_flag` case expects exactly `[]` (AC-21).
 * Deriving is what keeps a case whose JSON says one thing and whose flag says
 * another from ever reaching the API.
 */
export function deriveExpectation(value: unknown): EvalExpectation {
  return Array.isArray(value) && value.length === 0 ? "must_not_flag" : "must_find";
}

/** An existing case's stored expectation, pretty-printed for the editor. */
export function stringifyExpected(value: unknown): string {
  if (value === undefined || value === null) return "[]";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Circular or otherwise unserializable — never crash the editor over it.
    return "[]";
  }
}

/** The PR-meta tab's two fields, read defensively out of `input_meta: unknown`. */
export interface PrMeta {
  title: string;
  body: string;
}

export function readPrMeta(meta: unknown): PrMeta {
  if (typeof meta !== "object" || meta === null) return { title: "", body: "" };
  const record = meta as Record<string, unknown>;
  return {
    title: typeof record.title === "string" ? record.title : "",
    body: typeof record.body === "string" ? record.body : "",
  };
}

/** `null` rather than `{ title: "", body: "" }` — an empty meta is no meta. */
export function toInputMeta(meta: PrMeta): PrMeta | null {
  return meta.title.trim() === "" && meta.body.trim() === "" ? null : meta;
}

/** How one unified-diff line is coloured in the preview. */
export type DiffLineKind = "add" | "del" | "hunk" | "context";

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "context";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}
