import type {
  BlastCallerRef,
  BlastCronRef,
  BlastEndpointRef,
  BlastResponse,
  BlastStatus,
  BlastSymbolNode,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { BLAST_REASONS, DEPENDENT_DEPTH, MAX_SYMBOLS } from './constants.js';

/**
 * Blast Radius — what else a diff can reach.
 *
 * ZERO TOKENS, AND STRUCTURALLY SO, exactly as Smart Diff is: there is no path
 * from this file to `container.llm`. Every node and every edge below was looked
 * up in the persistent `repo-intel` index; nothing here is described, inferred
 * or summarised by a model, which is why the response has no prose field for
 * one to fill.
 *
 * NO PARSING ON THE HOT PATH, and that is a gate rather than a hope. The facade
 * method `getBlastRadius` has two branches — a persistent one that is pure SQL,
 * and a best-effort fallback that re-reads the clone and re-parses it with
 * tree-sitter. The fallback is correct for the prompt-assembly callers it was
 * written for and completely wrong for an HTTP request: a large repo would
 * spend seconds of CPU per page load. This service therefore establishes that
 * the persistent index is usable BEFORE it calls the facade at all, and returns
 * `degraded` rather than reaching for the slow path. `assertPersistentPath`
 * below is that check, and its conditions are deliberately the same ones
 * `tryPersistentBlast` uses to decide it can serve — if they drift apart, this
 * endpoint silently starts parsing.
 */

/** The three fields this service reads off a pull-request row. */
interface PullRef {
  id: string;
  repoId: string;
}

/** The one field it reads off a `pr_files` row. */
interface PrFileRef {
  path: string;
}

/**
 * The logger this service accepts — structural, so ring 2 does not depend on
 * Fastify's concrete logger (onion §5). Same shape as `SmartDiffLogger`, and
 * declared separately rather than imported from that sibling module.
 */
export interface BlastLogger {
  info(obj: unknown, msg?: string): void;
}

export class BlastService {
  constructor(private container: Container) {}

  /**
   * Build the impact map for one PR.
   *
   * @param workspaceId the caller's workspace — the tenancy key, not a hint
   * @param prId        the PR, already validated as a uuid by the route schema
   * @param log         optional; the proof line about what was READ goes here
   */
  async get(workspaceId: string, prId: string, log?: BlastLogger): Promise<BlastResponse> {
    // 1. TENANCY GATE, FIRST, ALWAYS. `getPrFiles` and every `repoIntel` read
    //    below take a bare id and cannot scope themselves; this lookup IS the
    //    workspace boundary. Moving it after any read turns the route into a
    //    cross-workspace read of another tenant's code map.
    const pull: PullRef | undefined = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const rows: PrFileRef[] = await this.container.reviewRepo.getPrFiles(prId);
    // `getPrFiles` issues no ORDER BY, so the read has no order to preserve.
    // Sorting here makes the response stable across calls — otherwise the same
    // PR renders its changed-file list in a different sequence after any write
    // that moves rows around, which reads as data changing when nothing did.
    const changedFiles = rows.map((r) => r.path).sort();

    const state = await this.container.repoIntel.getIndexState(pull.repoId);
    const indexedSha = state.lastIndexedSha || null;

    // 2. THE GATE. Everything after this point is an indexed read; everything
    //    that fails here returns without touching the facade.
    const blocked = this.assertPersistentPath(state.status);
    if (blocked) {
      log?.info(
        { pr_id: prId, blast_status: 'degraded', reason: blocked.key, read: 'repo_index_state' },
        'blast: no usable index — nothing computed, no parsing attempted',
      );
      return empty('degraded', blocked.message, changedFiles, indexedSha);
    }
    if (changedFiles.length === 0) {
      return empty('full', null, changedFiles, indexedSha);
    }

    // 3. Two indexed reads. `getBlastRadius` answers "who calls the symbols
    //    this diff declares" (reference-level, one hop by construction);
    //    `getDependents` answers "which modules sit downstream of these files"
    //    (module-level, two hops). They are different graphs and the second is
    //    what turns a caller list into an endpoint list.
    const [blast, dependents, ownFacts] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles),
      this.container.repoIntel.getDependents(pull.repoId, changedFiles, DEPENDENT_DEPTH),
      this.container.repoIntel.getFileFacts(pull.repoId, changedFiles),
    ]);

    // 4. Group callers under the symbol they reach. `callers` is already sorted
    //    by rank DESC and capped per symbol by the facade; this only pivots it.
    const callersBySymbol = new Map<string, BlastCallerRef[]>();
    for (const c of blast.callers) {
      const list = callersBySymbol.get(c.viaSymbol) ?? [];
      list.push({ file: c.file, symbol: c.symbol, line: c.line, rank: c.rank });
      callersBySymbol.set(c.viaSymbol, list);
    }

    const allSymbols: BlastSymbolNode[] = blast.changedSymbols
      .map((s) => {
        const callers = callersBySymbol.get(s.name) ?? [];
        return {
          name: s.name,
          file: s.file,
          kind: s.kind,
          callers,
          // Equal to `callers.length` today, and kept as its own field because
          // the facade's per-symbol cap is the one thing between them: when it
          // bites, the UI must be able to say "20 of 47" rather than present
          // the cap as the total.
          callers_total: callers.length,
        };
      })
      // Widest reach first — a symbol nothing calls is the least interesting
      // row on the page, and on a large diff it should not be the first one.
      .sort((a, b) => b.callers.length - a.callers.length || a.name.localeCompare(b.name));

    /**
     * The cap is applied HERE and counted from `allSymbols` below, in that
     * order, because the reverse silently misreports.
     *
     * `counts` used to be computed from the sliced list, so a PR declaring more
     * than `MAX_SYMBOLS` symbols reported the cap as its total and nothing on
     * any surface said the list was short. `constants.ts` claimed the opposite.
     * A truncation nobody can see is the same defect as the caller cap this
     * module already fixes one file over: a limit that reads as a fact about
     * the code.
     */
    const symbols = allSymbols.slice(0, MAX_SYMBOLS);

    // 5. Endpoints and crons, from two sources that are NOT the same claim.
    //
    //    depth 0 — a changed file declares the route itself. The PR touches it
    //    directly; there is no graph walk involved and none should be implied.
    //    depth 1-2 — a file that (transitively) imports a changed file declares
    //    it. That is the downstream claim, and it weakens with distance, which
    //    is why `depth` ships instead of being flattened away here.
    const endpoints: BlastEndpointRef[] = [];
    const crons: BlastCronRef[] = [];
    for (const f of ownFacts) {
      for (const route of f.endpoints) {
        endpoints.push({ route, file: f.file, depth: 0, via: f.file });
      }
      for (const name of f.crons) crons.push({ name, file: f.file, depth: 0, via: f.file });
    }
    for (const d of dependents) {
      for (const route of d.endpoints) {
        endpoints.push({ route, file: d.file, depth: d.depth, via: d.via });
      }
      for (const name of d.crons) crons.push({ name, file: d.file, depth: d.depth, via: d.via });
    }
    // DEDUPED HERE, not per consumer. The same route string can be found twice
    // in one file, and a file can be reached at two depths; whichever surface
    // renders the result then has to collapse them, and for one round only the
    // web client did — so `counts.endpoints` and the MCP tool's list disagreed
    // with the tab about the same pull request. A count that depends on who is
    // asking is worse than either count.
    const uniqueEndpoints = dedupe(
      endpoints,
      (e) => `${e.route}|${e.file}`,
    ).sort((a, b) => a.depth - b.depth || a.route.localeCompare(b.route));
    const uniqueCrons = dedupe(crons, (c) => `${c.name}|${c.file}`).sort(
      (a, b) => a.depth - b.depth || a.name.localeCompare(b.name),
    );

    // 6. Status. `partial` is a property of the INDEX, not of the result, so an
    //    incomplete index stays `partial` even when it happened to find plenty
    //    — the caveat is "this list may be short", and that is true either way.
    let status: BlastStatus = 'full';
    let reason: string | null = null;
    if (state.status === 'partial') {
      status = 'partial';
      reason = BLAST_REASONS.partial_index;
    } else if (allSymbols.length === 0) {
      // A full index that declares no symbols in any changed file is not a
      // failure and not an empty answer: it is a diff made of config, docs or
      // generated files. Saying so beats rendering a blank panel.
      status = 'partial';
      reason = BLAST_REASONS.no_symbols;
    }

    log?.info(
      {
        pr_id: prId,
        blast_status: status,
        changed_files: changedFiles.length,
        symbols: allSymbols.length,
        symbols_shown: symbols.length,
        callers: blast.callers.length,
        endpoints: uniqueEndpoints.length,
        dependents: dependents.length,
        // What this was computed FROM. The claim being evidenced is "no clone
        // was read and nothing was parsed" — these are all index tables.
        read: 'symbols, references, file_edges, file_facts, file_rank',
        llm_calls: 0,
      },
      'blast: computed from the persistent index (0 model calls, 0 files parsed)',
    );

    return {
      status,
      reason,
      changed_files: changedFiles,
      symbols,
      endpoints: uniqueEndpoints,
      crons: uniqueCrons,
      indexed_sha: indexedSha,
      counts: {
        symbols: allSymbols.length,
        callers: allSymbols.reduce((n, s) => n + s.callers.length, 0),
        endpoints: uniqueEndpoints.length,
      },
    };
  }

  /**
   * Is the persistent index usable? Returns `null` when it is, or the reason it
   * is not.
   *
   * These conditions MIRROR `RepoIntelService.tryPersistentBlast`: it serves
   * only when the flag is on and the state row says `full` or `partial`, and
   * returns null otherwise — at which point `getBlastRadius` silently falls
   * through to the clone-parsing branch. Checking the same conditions up here
   * is what makes "the server does not re-parse the repo during a request" a
   * structural property of this endpoint rather than a hope about a call it
   * does not control. If that method's gate ever changes, this one has to move
   * with it, and the integration test pins the pairing.
   */
  private assertPersistentPath(
    status: string,
  ): { key: keyof typeof BLAST_REASONS; message: string } | null {
    if (!this.container.config.repoIntelEnabled) {
      return { key: 'flag_off', message: BLAST_REASONS.flag_off };
    }
    if (status === 'failed') {
      return { key: 'index_failed', message: BLAST_REASONS.index_failed };
    }
    if (status !== 'full' && status !== 'partial') {
      return { key: 'no_index', message: BLAST_REASONS.no_index };
    }
    return null;
  }
}

/**
 * Keep the FIRST row for each key.
 *
 * Callers pass the depth-0 rows before the walked ones and the walk is
 * breadth-first, so "first" is always the shallowest — which is the stronger
 * claim, and the one to keep when the same route turns up twice.
 */
function dedupe<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * A well-formed response that computed nothing.
 *
 * Every array is present and empty and `reason` carries a sentence, so a
 * consumer branches on `status` and never on the shape. The alternative — a
 * 404, or a body with fields missing — makes "no index" indistinguishable from
 * "no impact" at exactly the moment the difference matters.
 */
function empty(
  status: BlastStatus,
  reason: string | null,
  changedFiles: string[],
  indexedSha: string | null,
): BlastResponse {
  return {
    status,
    reason,
    changed_files: changedFiles,
    symbols: [],
    endpoints: [],
    crons: [],
    indexed_sha: indexedSha,
    counts: { symbols: 0, callers: 0, endpoints: 0 },
  };
}
