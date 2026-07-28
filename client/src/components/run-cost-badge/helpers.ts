/**
 * Formatters for RunCostBadge. Kept apart from the component so the format
 * rules — the part that actually carries a decision — are testable on their own.
 */

/**
 * USD spend, formatted so a real cost is never rounded away to `$0.00`.
 *
 * `null`/`undefined` means "unknown" (no run yet, or a run that failed before
 * we could account for it) and renders as an em-dash. `0` is a genuine value —
 * free models exist — so the two must not collapse into one.
 *
 * A typical OpenRouter review costs ~$0.0013, which is why sub-cent amounts get
 * a fourth decimal: 3 decimals would show it as `$0.001` and 2 as `$0.00`.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

/** Prompt→completion token flow, e.g. `8.2K→1.3K`. */
export function formatTokenFlow(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(1)}K→${(tokensOut / 1000).toFixed(1)}K`;
}
