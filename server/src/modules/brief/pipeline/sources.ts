import type {
  BlastCronRef,
  BlastEndpointRef,
  BlastResponse,
  BlastSymbolNode,
  PrIntentRecord,
} from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import { NotFoundError } from '../../../platform/errors.js';
import type { BriefBlockName } from '../constants.js';

/**
 * Brief input: collect (this file, top half) → render (this file, bottom half).
 *
 * A USE-CASE FUNCTION, NOT A SERVICE METHOD. Two callers need it and neither
 * should wait on the other: `BriefService.build` and the measuring CLI
 * (`src/tools/measure-brief-input.ts`). A CLI is transport like any other (onion
 * §9), so it calls the use case rather than reaching past it into a repository —
 * and because the collection is a function, the CLI can measure exactly what the
 * service would have sent, not an approximation of it.
 *
 * FOREIGN DATA COMES THROUGH THE COMPOSITION ROOT, ALWAYS. `container.blast`,
 * `container.intent`, `container.contextRepo`, `container.reviewRepo` — never an
 * import from a sibling module's folder (onion §11).
 *
 * NO PATCH BODIES, STRUCTURALLY (AC-2). `CollectedFileStat` has three fields and
 * none of them can hold a hunk, so "the brief does not send diff bodies" is a
 * property of the type rather than a rule someone has to keep remembering. The
 * fixture in `test/brief-sources.test.ts` fills `pr_files.patch` precisely so
 * this is asserted rather than assumed.
 *
 * EVERYTHING HERE IS UNTRUSTED (ASI01/ASI09). PR titles, issue bodies, project
 * documents and — new to this feature — repository paths and route strings out
 * of the index are all attacker-reachable text. This file does not sanitise
 * them; `pipeline/prompt.ts` wraps every one of them, and the wrapping is what
 * `test_brief_prompt_guard` enumerates.
 */

/** One changed file's size. No `patch` field, and that is AC-2. */
export interface CollectedFileStat {
  path: string;
  additions: number;
  deletions: number;
}

/** One project-context document, whole. */
export interface CollectedDoc {
  name: string;
  body: string;
}

/** The linked issue's text, when it could be read. */
export interface CollectedIssue {
  ref: string;
  text: string;
}

/**
 * Everything the brief may show a model, before any budgeting.
 *
 * Structured rather than pre-rendered because the budget's levels operate on the
 * structure — five callers per symbol, fifty largest files, whole documents from
 * the end of the name order — and then re-render. A pre-rendered input can only
 * be cut with a substring, which is the silent truncation NFR-8 forbids.
 */
export interface CollectedInput {
  prId: string;
  headSha: string;
  /** Author-written, untrusted, and never dropped (AC-24). */
  prTitle: string;
  /**
   * The intent line: claim plus provenance, rendered by `modules/intent` itself
   * through `container.intent.renderIntentBlock`. Null when this PR has no
   * derived intent at all — which the service avoids by deriving first (AC-3),
   * and the measuring CLI does not, because it never calls a model.
   */
  intentBlock: string | null;
  /** The impact map, as `container.blast` answered — `degraded` included (AC-8). */
  blast: BlastResponse;
  /** PR-level totals off the pull row. */
  diffStats: { additions: number; deletions: number; filesCount: number };
  /**
   * Per-file sizes, sorted by `additions + deletions` DESC, path ASC to break
   * ties. `getPrFiles` issues no `ORDER BY`, so a PR's files have no order to
   * preserve (`server/INSIGHTS.md`, 2026-08-08) — and the sort is NOT a cap: it
   * only makes "the 50 largest" a defined set for when budget level 5 fires.
   *
   * NOTHING EVER REMOVES AN ENTRY FROM THIS ARRAY. Every changed file's PATH is
   * undroppable (AC-24), and the reason is grounding rather than tidiness: the
   * allowlist is built from these paths, so a shortened list quietly narrows
   * AC-9 and AC-68 into rejecting correct citations of files the model was
   * simply never shown. Level 5 removes the NUMBERS instead — see
   * `fileStatSizesFor` below.
   */
  fileStats: CollectedFileStat[];
  /**
   * How many of `fileStats` still carry their `+/−` counts, or `null` while all
   * of them do.
   *
   * This is budget level 5 (AC-65) expressed as data rather than as a cut: the
   * array keeps every file, and the renderer prints a bare path past this index.
   * Written as a count and not a boolean so the render rule and the test can
   * both state the same number, and so `dropped_blocks` can say what was really
   * given up — the sizes, never the files.
   */
  fileStatSizesFor: number | null;
  /** Every document of this repo's store, by name (AC-32). Never sampled here. */
  contextDocs: CollectedDoc[];
  /** The linked issue's text, or null (AC-33/AC-34). */
  linkedIssue: CollectedIssue | null;
  /**
   * What was named and could not be read (AC-59). A different absence from
   * `dropped_blocks`, which is what we had and could not afford.
   */
  unavailableInputs: string[];
}

/** What the collector reads off the pull row — no ORM row travels inward (§5). */
interface PullRef {
  id: string;
  repoId: string;
  title: string;
  headSha: string;
  additions: number;
  deletions: number;
  filesCount: number;
}

/** What it reads off a `pr_files` row. Note the absent `patch`. */
interface PrFileRef {
  path: string;
  additions: number;
  deletions: number;
}

export interface CollectBriefOptions {
  /**
   * The intent to describe this PR with. The SERVICE passes the record it just
   * derived or reused (AC-3/AC-4); when nothing is passed the collector reads
   * whatever is stored and never derives, because deriving costs a model call
   * and this function must be safe for the measuring CLI to run.
   */
  intent?: PrIntentRecord | null;
}

/**
 * Collect the six sources of a brief (AC-1).
 *
 * @param workspaceId the caller's workspace — the tenancy key, not a hint
 * @param prId        the PR, already validated as a uuid by the route schema
 */
export async function collectBriefInput(
  container: Container,
  workspaceId: string,
  prId: string,
  opts: CollectBriefOptions = {},
): Promise<CollectedInput> {
  // TENANCY GATE, FIRST, ALWAYS. `pr_brief` has no `workspace_id` and neither
  // has `pr_intent`; every read below takes a bare id and cannot scope itself.
  // This lookup IS the workspace boundary, and moving it after any other read
  // turns the endpoint into a cross-tenant read.
  const pull: PullRef | undefined = await container.reviewRepo.getPull(workspaceId, prId);
  if (!pull) throw new NotFoundError('Pull request not found');

  const repoRow = await container.reviewRepo.getRepo(pull.repoId);
  if (!repoRow) throw new NotFoundError('Repo not found');

  const unavailableInputs: string[] = [];

  // 1. intent — the caller decides whether it was worth deriving; this only reads.
  const intentRecord =
    opts.intent !== undefined
      ? opts.intent
      : (await container.intent.view(workspaceId, prId)).intent;
  const intentBlock = intentRecord ? container.intent.renderIntentBlock(intentRecord) : null;
  if (!intentRecord) unavailableInputs.push('no intent has been derived for this PR');

  // 2. blast — through `container.blast`, NEVER `container.repoIntel
  //    .getBlastRadius`. The facade has a cheap indexed branch and an expensive
  //    re-parse fallback and returns the same shape either way; the service is
  //    the thing that checks the index first (`server/INSIGHTS.md`, 2026-08-13).
  //    A `degraded` answer is an input to grounding (AC-8), not an error.
  const blast = await container.blast.get(workspaceId, prId);

  // 3 + 4. diff statistics, PR-level off the pull row and per-file off `pr_files`.
  const fileRows: PrFileRef[] = await container.reviewRepo.getPrFiles(prId);
  const fileStats: CollectedFileStat[] = fileRows
    .map((r) => ({ path: r.path, additions: r.additions, deletions: r.deletions }))
    .sort(
      (a, b) =>
        b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path),
    );

  // 5. project-context documents: ALL of them, by name (AC-32). No relevance
  //    mechanism exists in this product, and sampling here would invent one.
  const docRows = await container.contextRepo.listDocs(workspaceId, pull.repoId);
  const contextDocs: CollectedDoc[] = docRows
    .map((d) => ({ name: d.name, body: d.body }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // 6. the linked issue's text, fetched live through `container.intent`
  //    (AC-33/AC-34/AC-59). `null` means this PR links no readable issue, which
  //    is not a gap; a `note` means one was named and would not come back, which
  //    is.
  let linkedIssue: CollectedIssue | null = null;
  if (intentRecord) {
    const issue = await container.intent.linkedIssueText(intentRecord, {
      owner: repoRow.owner,
      name: repoRow.name,
    });
    if (issue && 'text' in issue) linkedIssue = { ref: issue.ref, text: issue.text };
    else if (issue) unavailableInputs.push(`linked issue ${issue.ref} ${issue.note}`);

    // AN ISSUE THE DERIVATION ITSELF COULD NOT READ IS THE SAME GAP, reached by
    // the other road. `linkedIssueText` answers `null` for it — it only looks at
    // `used` sources — so without this the brief would be built without an issue
    // it knows about and would report nothing, which is precisely the silence
    // AC-59 exists to prevent. Found by `test_brief_input_it`: mocking GitHub to
    // fail made the CLASSIFIER record the issue as unavailable first, and the
    // brief then had nothing to say about it.
    for (const s of intentRecord.sources) {
      if (s.kind !== 'linked_issue' || s.status !== 'unavailable') continue;
      unavailableInputs.push(`linked issue ${s.ref}${s.note ? ` ${s.note}` : ' could not be read'}`);
    }
  }

  return {
    prId: pull.id,
    headSha: pull.headSha,
    prTitle: pull.title,
    intentBlock,
    blast,
    diffStats: {
      additions: pull.additions,
      deletions: pull.deletions,
      filesCount: pull.filesCount,
    },
    fileStats,
    // Collection never budgets: every file starts out with its numbers.
    fileStatSizesFor: null,
    contextDocs,
    linkedIssue,
    unavailableInputs,
  };
}

// ---------------------------------------------------------------------------
// Render — the second half. Structure in, named text blocks out.
//
// NO CAPS LIVE HERE, and that is the design, not an omission. "Five callers per
// symbol" and "the fifty largest files" are BUDGET LEVELS (AC-64, AC-65), and a
// level applied during rendering is a level that can never fire in production:
// it would trim the input before anything measured it, so it would never appear
// in `dropped_blocks`, the user would never learn the list was short, and a unit
// test feeding an un-truncated fixture would still go green. That is the silent
// truncation NFR-8 forbids, and it is the same shape of defect as a gate armed
// only on fixtures (`server/INSIGHTS.md`, 2026-08-06).
//
// The only caps in force before the budget are OTHER modules': `MAX_SYMBOLS`
// (blast) and `MAX_CALLERS_PER_SYMBOL` (repo-intel) arrive already applied
// inside the blast response. This module neither duplicates nor tightens them.
// ---------------------------------------------------------------------------

/** A named block of prompt text. The name is what `dropped_blocks` reports. */
export interface RenderedBlock {
  name: BriefBlockName;
  text: string;
}

function renderSymbols(symbols: BlastSymbolNode[]): string {
  return symbols
    .map((s) => {
      const callers = [...s.callers].sort(
        (a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line,
      );
      const head =
        `${s.kind} ${s.name} (${s.file}) — ${s.callers_total} caller(s)` +
        (callers.length < s.callers_total ? `, showing ${callers.length}` : '');
      const body = callers.map((c) => `    called by ${c.symbol} at ${c.file}:${c.line}`);
      return [head, ...body].join('\n');
    })
    .join('\n');
}

function renderEndpoints(endpoints: BlastEndpointRef[]): string {
  return endpoints
    .map((e) => `${e.route} (${e.file}, ${e.depth} hop(s) from ${e.via})`)
    .join('\n');
}

function renderCrons(crons: BlastCronRef[]): string {
  return crons.map((c) => `${c.name} (${c.file}, ${c.depth} hop(s) from ${c.via})`).join('\n');
}

/**
 * Render the collected input into named blocks, in a fixed order.
 *
 * Deterministic: called twice on the same input it returns the same strings, so
 * the budget can re-render after each level and compare like with like, and the
 * measuring CLI reports a number the service would really have sent. Every
 * ordering visible in the output is established by an explicit sort — either
 * here or in `collectBriefInput` — because Map/Set iteration order is exactly
 * how a cache and a test start flickering.
 *
 * A block with nothing in it is omitted rather than rendered empty: an empty
 * heading costs tokens to say nothing, and a block that is absent because it had
 * no content must not be confused with one the budget dropped.
 */
export function renderBriefBlocks(input: CollectedInput): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  const push = (name: BriefBlockName, text: string) => {
    if (text.trim().length > 0) blocks.push({ name, text });
  };

  push('pr-title', input.prTitle);
  push('intent', input.intentBlock ?? '');

  const { blast } = input;
  const statusLine =
    blast.status === 'full'
      ? ''
      : `Impact map is ${blast.status}${blast.reason ? `: ${blast.reason}` : ''}. `;
  push(
    'blast-symbols',
    statusLine + (blast.symbols.length > 0 ? `\n${renderSymbols(blast.symbols)}` : 'No symbols.'),
  );
  push('blast-endpoints', renderEndpoints(blast.endpoints));
  push('blast-crons', renderCrons(blast.crons));

  push(
    'diff-stats',
    `+${input.diffStats.additions} -${input.diffStats.deletions} across ` +
      `${input.diffStats.filesCount} file(s)`,
  );
  // EVERY PATH, ALWAYS (AC-24); the numbers only for as many as the budget left
  // room for (AC-65). Past that index the line is the bare path — the file is
  // still in front of the model and still in the grounding allowlist, it just no
  // longer says how much of it changed.
  const sizesFor = input.fileStatSizesFor;
  push(
    'file-stats',
    input.fileStats
      .map((f, i) =>
        sizesFor === null || i < sizesFor ? `${f.path} +${f.additions} -${f.deletions}` : f.path,
      )
      .join('\n'),
  );

  push(
    'context-docs',
    input.contextDocs.map((d) => `--- ${d.name} ---\n${d.body}`).join('\n\n'),
  );
  push(
    'linked-issue',
    input.linkedIssue ? `${input.linkedIssue.ref}\n${input.linkedIssue.text}` : '',
  );

  return blocks;
}
