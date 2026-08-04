/**
 * Sample selection and rendering — the code-only half of the extractor.
 *
 * No model runs here. What the model gets to see is decided by an allowlist and
 * a rank order, so the same repo at the same SHA always produces the same
 * prompt, and "why did it not find X" has an answer you can read.
 *
 * Everything in this file is PURE: it takes file contents and returns text plus
 * a record of what that text contained. The reads happen in `service.ts` through
 * the `SourceReader` port. That split is what lets the verifier check the model's
 * citations against the exact bytes the prompt carried, rather than against a
 * second read of a file that may have changed in between.
 */
import {
  MAX_SAMPLE_BYTES,
  MAX_SAMPLE_LINES,
  MAX_TOTAL_BYTES,
  PACKAGE_JSON_KEYS,
} from '../constants.js';

/** One file exactly as the model saw it. The verifier's source of truth. */
export interface SampledFile {
  path: string;
  /** Every line of the file, 0-indexed here, 1-indexed in the prompt. */
  lines: string[];
  /** Highest 1-based line number that actually reached the prompt. */
  shownUpTo: number;
  /** Lines in the whole file — larger than `shownUpTo` when truncated. */
  totalLines: number;
}

export interface SampleInput {
  path: string;
  content: string;
  /** Config files get their own, smaller byte cap and are never line-capped. */
  maxBytes?: number;
}

export interface SampleBlock {
  /** The rendered text for the prompt. */
  text: string;
  /** What that text contained, by path. */
  sampled: Map<string, SampledFile>;
  /** Paths that did not fit in `MAX_TOTAL_BYTES`. */
  skipped: string[];
}

/**
 * Pick one file per config family from the set that turned out to be readable.
 * Order follows `CONFIG_FAMILIES`, so the prompt's config section is stable.
 */
export function pickConfigFiles(
  families: readonly (readonly string[])[],
  present: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const family of families) {
    const hit = family.find((p) => present.has(p));
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Reduce a `package.json` to the keys that say something about how the team
 * works. Returns `null` when the file is not parseable JSON — a broken
 * package.json is not worth guessing at, and dropping it costs one sample.
 */
export function reducePackageJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const key of PACKAGE_JSON_KEYS) {
    if (source[key] !== undefined) kept[key] = source[key];
  }
  return JSON.stringify(kept, null, 2);
}

/**
 * Render one file with 1-based line numbers, truncated to the caps.
 *
 * The line numbers are the whole reason a citation can be checked at all, and
 * the truncation notice is what stops the model citing line 300 of a file it was
 * shown 180 lines of. Both are load-bearing, not decoration.
 */
export function renderFile(input: SampleInput): { text: string; sampled: SampledFile } {
  const lines = splitLines(input.content);
  const maxBytes = input.maxBytes ?? MAX_SAMPLE_BYTES;

  let shownUpTo = 0;
  let bytes = 0;
  while (shownUpTo < lines.length && shownUpTo < MAX_SAMPLE_LINES) {
    const next = Buffer.byteLength(lines[shownUpTo]!, 'utf8') + 1;
    if (shownUpTo > 0 && bytes + next > maxBytes) break;
    bytes += next;
    shownUpTo += 1;
  }

  const truncated = shownUpTo < lines.length;
  const header = truncated
    ? `--- ${input.path} (lines 1-${shownUpTo} of ${lines.length}, truncated) ---`
    : `--- ${input.path} (${lines.length} lines) ---`;

  const width = String(shownUpTo).length;
  const body = lines
    .slice(0, shownUpTo)
    .map((line, i) => `${String(i + 1).padStart(width)}| ${line}`)
    .join('\n');

  return {
    text: `${header}\n${body}`,
    sampled: { path: input.path, lines, shownUpTo, totalLines: lines.length },
  };
}

/**
 * Render every input into one block, stopping at the total budget.
 *
 * Stopping rather than shrinking is deliberate: a file cut to whatever bytes
 * remain is the one case where the truncation notice stops being honest, because
 * the cut has nothing to do with the file's own cap. Order matters — pass the
 * configs first, since they are small and the most rule-dense thing in a repo.
 */
export function buildSampleBlock(inputs: SampleInput[]): SampleBlock {
  const parts: string[] = [];
  const sampled = new Map<string, SampledFile>();
  const skipped: string[] = [];
  let total = 0;

  for (const input of inputs) {
    if (skipped.length > 0) {
      // Once one file has been refused, refuse the rest: a later, smaller file
      // sneaking in would make the sample set depend on file size rather than
      // on rank, which is the ordering the whole feature is built on.
      skipped.push(input.path);
      continue;
    }
    const rendered = renderFile(input);
    const size = Buffer.byteLength(rendered.text, 'utf8');
    if (total > 0 && total + size > MAX_TOTAL_BYTES) {
      skipped.push(input.path);
      continue;
    }
    parts.push(rendered.text);
    sampled.set(input.path, rendered.sampled);
    total += size;
  }

  return { text: parts.join('\n\n'), sampled, skipped };
}

/**
 * Split into lines the way an editor counts them: CRLF and CR both end a line,
 * and a trailing newline does NOT create a phantom final line. Getting this
 * wrong shifts every citation in a CRLF repo by nothing at all — until the last
 * line, where an off-by-one turns a valid citation into `line_out_of_range`.
 */
function splitLines(content: string): string[] {
  const normalised = content.replace(/\r\n?/g, '\n');
  const lines = normalised.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
