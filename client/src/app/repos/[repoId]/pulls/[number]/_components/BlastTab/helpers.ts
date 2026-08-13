/** Short form of a commit sha, for the "indexed at" line. */
export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/**
 * The message key describing how far a downstream item sits from the diff.
 *
 * Depth is not decoration: 0 means a changed file declares the route itself, so
 * the PR edits it directly, while 2 means "reachable through two imports" — a
 * claim a reviewer should weigh differently. Flattening them into one label is
 * how a two-hop maybe starts reading like a direct hit.
 */
export function depthKey(depth: number): "direct" | "one" | "many" {
  if (depth <= 0) return "direct";
  if (depth === 1) return "one";
  return "many";
}
