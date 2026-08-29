/* helpers.ts — pure logic for RunCompare: the word-level prompt diff and the
   four delta formatters.

   Two rules govern this file:

     1. UNKNOWN IS NOT ZERO. Every metric and every delta is `number | null`;
        `null` in, `null` out, and the component renders nothing rather than a
        fabricated `0`. There is no `?? 0` here.
     2. The diff is computed in the BROWSER, from two stored snapshots, with zero
        model calls — and it is returned as data, never as markup. The component
        renders the tokens as text, so no `dangerouslySetInnerHTML` is needed
        anywhere on this path (the same viewer shows case diffs, which are not
        internally authored). */

/** One word-level token of the prompt diff. */
export interface DiffToken {
  /** The text, whitespace included — the split keeps separators so joins are lossless. */
  text: string;
  kind: "same" | "del" | "add";
}

/**
 * Word-level LCS diff of two prompt snapshots, ported from the design's
 * `diffTokens` (`screen_skillslab_evaldashboard.jsx:286-302`).
 *
 * Splitting on `(\s+)` keeps the separators as tokens, so re-joining the output
 * reproduces either input exactly — a prompt's indentation is part of what
 * changed between two versions.
 */
export function diffTokens(oldText: string, newText: string): DiffToken[] {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = length of the LCS of a[i…] and b[j…]. The table is allocated at
  // exactly (n+1) × (m+1) and every index below is bounded by the loops, which
  // is why the `!`s are safe under `noUncheckedIndexedAccess` — a `?? 0` here
  // would silently paper over an off-by-one instead of crashing on one.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ text: a[i]!, kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ text: a[i]!, kind: "del" });
      i++;
    } else {
      out.push({ text: b[j]!, kind: "add" });
      j++;
    }
  }
  while (i < n) out.push({ text: a[i++]!, kind: "del" });
  while (j < m) out.push({ text: b[j++]!, kind: "add" });
  return out;
}

/**
 * Which of the three prompt-diff states applies. All three are user-visible
 * copy; none of them is a blank panel.
 *
 *   - `missing`   — at least one batch has no snapshot to diff against (AC-91).
 *     The server has already decided this (`prompt_diff_available`); the null
 *     check beside it is belt-and-braces for a response where the flag and the
 *     fields disagree.
 *   - `identical` — both snapshots exist and are equal (AC-90). A word-level
 *     diff of two identical strings is a correct, and completely useless,
 *     wall of unchanged text.
 *   - `diff`      — there is something to show.
 */
export type PromptDiffState = "missing" | "identical" | "diff";

export function promptDiffState(
  available: boolean,
  oldPrompt: string | null,
  newPrompt: string | null,
): PromptDiffState {
  if (!available || oldPrompt === null || newPrompt === null) return "missing";
  if (oldPrompt === newPrompt) return "identical";
  return "diff";
}

/**
 * A 0…1 metric as a whole-percent string, or `null` when it is unknown — the
 * caller renders `dashboard.unknownValue` with its tooltip.
 */
export function formatPercent(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * A 0…1 delta as signed whole percentage points, or `null` when the delta does
 * not exist.
 *
 * `null` means ABSENT — the metric was unknown in at least one of the two
 * batches — and the caller renders no delta at all. A delta that is genuinely
 * `0` returns `"▲ 0pt"` and IS rendered: absence and "moved by zero" are two
 * different facts and must not look alike (AC-73).
 */
export function formatDeltaPoints(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const points = Math.round(value * 100);
  return `${points >= 0 ? "▲" : "▼"} ${Math.abs(points)}pt`;
}

/**
 * A USD delta, signed, at the precision a real run needs.
 *
 * A typical run costs ~$0.0013, so two decimals would render every cost move as
 * `$0.00`. `null` is an unknown cost in one of the two batches and renders
 * nothing (AC-110 inheriting the server's AC-52) — never `$0.00`, which would
 * claim the run was free.
 */
export function formatDeltaCost(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  const amount = abs >= 1 ? abs.toFixed(2) : abs >= 0.01 ? abs.toFixed(3) : abs.toFixed(4);
  return `${value >= 0 ? "▲" : "▼"} $${amount}`;
}

/** Sign of a delta, for colouring. A known zero is neutral, never "improved". */
export function deltaDirection(value: number | null | undefined): "up" | "down" | "flat" | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}
