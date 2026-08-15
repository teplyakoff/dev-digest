import type { BlastCronRef, BlastEndpointRef, BlastSymbolNode } from "@devdigest/shared";

/** Short form of a commit sha, for the "indexed at" line. */
export function shortSha(sha: string | null): string | null {
  return sha ? sha.slice(0, 7) : null;
}

/** Downstream items attributed to one changed symbol. */
export interface Downstream {
  endpoints: BlastEndpointRef[];
  crons: BlastCronRef[];
}

export interface GroupedDownstream {
  /** Keyed by the changed FILE a symbol is declared in. */
  byFile: Map<string, Downstream>;
  /** Reached from a file that declares no symbol on screen. Never dropped. */
  orphanEndpoints: BlastEndpointRef[];
  orphanCrons: BlastCronRef[];
}

/**
 * Attribute each endpoint and cron to the changed symbol it belongs under.
 *
 * THE JOIN KEY IS `via`, which the server sets to the changed file a downstream
 * item was reached from — itself at depth 0, or the origin of the walk deeper
 * down. So an item belongs to every symbol declared in that file. That is the
 * honest link available: reachability is computed per FILE (the import graph has
 * no finer resolution), while the tree presents symbols, and pretending the
 * server attributed a route to one specific symbol would be inventing precision
 * the index does not have.
 *
 * ORPHANS ARE KEPT, not dropped. A route can be reached from a changed file
 * whose symbols were cut by the server's cap, or that declares nothing the
 * indexer tracks — and silently losing it would turn a display rule into a
 * missing fact. The card renders them in their own group.
 */
export function groupDownstream(
  symbols: BlastSymbolNode[],
  endpoints: BlastEndpointRef[],
  crons: BlastCronRef[],
): GroupedDownstream {
  const symbolFiles = new Set(symbols.map((s) => s.file));
  const byFile = new Map<string, Downstream>();
  const orphanEndpoints: BlastEndpointRef[] = [];
  const orphanCrons: BlastCronRef[] = [];

  const bucket = (file: string): Downstream => {
    const found = byFile.get(file);
    if (found) return found;
    const made: Downstream = { endpoints: [], crons: [] };
    byFile.set(file, made);
    return made;
  };

  for (const e of endpoints) {
    if (symbolFiles.has(e.via)) bucket(e.via).endpoints.push(e);
    else orphanEndpoints.push(e);
  }
  for (const c of crons) {
    if (symbolFiles.has(c.via)) bucket(c.via).crons.push(c);
    else orphanCrons.push(c);
  }
  return { byFile, orphanEndpoints, orphanCrons };
}

/**
 * The symbol the graph view draws.
 *
 * The design graphs `downstream[0]` because its mock is hand-built and its first
 * entry is always the interesting one. On real data the first symbol can have no
 * callers at all, which would draw a single node and nothing else — so pick the
 * widest-reaching one and let the caption name it.
 */
export function graphSubject(symbols: BlastSymbolNode[]): BlastSymbolNode | null {
  let best: BlastSymbolNode | null = null;
  for (const s of symbols) {
    if (s.callers.length === 0) continue;
    if (!best || s.callers.length > best.callers.length) best = s;
  }
  return best;
}

/** Node positions for one column of the graph, spread over the usable height. */
export function columnLayout(count: number, height: number, top = 34): number[] {
  if (count === 0) return [];
  // The design divides by `count - 1`, which is `Infinity` for a single node and
  // NaN for none — its mock never has fewer than two. Centre a lone node instead.
  if (count === 1) return [height / 2];
  const span = (height - top * 2) / (count - 1);
  return Array.from({ length: count }, (_, i) => top + i * span);
}
