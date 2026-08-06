import type {
  DiffHunk,
  GitHubClient,
  IntentSource,
  RepoRef,
  SourceReader,
  UnifiedDiff,
} from '@devdigest/shared';
import {
  ALLOWED_DOC_EXTENSIONS,
  DENIED_PATH_PATTERN,
  SAFE_REPO_PATH_PATTERN,
  EXTERNAL_URL_PATTERN,
  LINKED_ISSUE_PATTERN,
  MAX_CHANGED_FILES,
  MAX_HUNK_HEADERS_PER_FILE,
  MAX_ISSUE_BODY_CHARS,
  MAX_PR_BODY_CHARS,
  MAX_REPO_FILE_BYTES,
  MAX_REPO_FILES,
  MAX_REPO_READ_ATTEMPTS,
  REPO_PATH_PATTERN,
} from '../constants.js';

/**
 * The collector: everything the classifier is allowed to see, and a record of
 * everything it was not.
 *
 * Pure over its inputs plus two injected ports (`GitHubClient`, `SourceReader`).
 * No `node:fs`, no Drizzle, no `process.env` — the paths here come from
 * attacker-controlled PR text, so reading them goes through the port that
 * already refuses `..`, absolute paths and symlinks out of the clone.
 *
 * TWO RULES THIS FILE EXISTS TO ENFORCE.
 *
 * 1. **Change bodies are never sent.** The classifier sees file paths and hunk
 *    HEADERS (`@@ -a,b +c,d @@`, rendered from four integers on `DiffHunk`) and
 *    nothing else. It never touches `diff.raw`, never `pr_files.patch`, never
 *    the contents of `hunk.newLineNumbers`. `server/test/intent-prompt.test.ts`
 *    pins this mechanically.
 * 2. **What could not be read is reported, never invented.** Every failure lands
 *    as an `IntentSource` with `status: 'unavailable'` AND a `missing_context`
 *    line. Telling the model what is missing is what stops it filling the gap
 *    itself.
 */

/** One untrusted block destined for the classifier's user message. */
export interface CollectedBlock {
  /** `wrapUntrusted` label, e.g. `pr-body`, `repo-file:docs/plan.md`. */
  label: string;
  text: string;
}

export interface CollectedSources {
  blocks: CollectedBlock[];
  sources: IntentSource[];
  missingContext: string[];
}

export interface CollectInput {
  title: string;
  body: string | null;
  /** `null` when the repo has no clone — repo files are then all unavailable. */
  clonePath: string | null;
  repo: RepoRef;
  diff: UnifiedDiff;
  github: () => Promise<GitHubClient>;
  sourceReader: SourceReader;
}

/**
 * Render one hunk as its header. Four integers in, a header out — this function
 * is the reason no change body can reach the prompt by accident.
 */
export function hunkHeader(h: Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>): string {
  return `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
}

/**
 * The changed-file block: path, +/- counts, and up to
 * `MAX_HUNK_HEADERS_PER_FILE` headers each.
 */
export function renderChangedFiles(diff: UnifiedDiff): string {
  const files = diff.files.slice(0, MAX_CHANGED_FILES);
  const lines: string[] = [];
  for (const f of files) {
    lines.push(`${f.path}  (+${f.additions} -${f.deletions})`);
    for (const h of f.hunks.slice(0, MAX_HUNK_HEADERS_PER_FILE)) lines.push(`  ${hunkHeader(h)}`);
    if (f.hunks.length > MAX_HUNK_HEADERS_PER_FILE) {
      lines.push(`  … ${f.hunks.length - MAX_HUNK_HEADERS_PER_FILE} more hunk(s)`);
    }
  }
  if (diff.files.length > files.length) {
    lines.push(`… ${diff.files.length - files.length} more changed file(s)`);
  }
  return lines.join('\n');
}

/**
 * Is this a path the classifier may read out of the target repo's clone?
 *
 * Three answers, and the caller records which: `ok`, `ext` (not a document), or
 * `denied` (a dotfile or a secret-shaped name). Exported because
 * `intent-sources.test.ts` asserts each branch directly.
 */
export function classifyCandidatePath(relPath: string): 'ok' | 'ext' | 'denied' {
  // FIRST, before anything else: a path that is not plain `[\w.-/]` is refused
  // outright. A read path becomes a `wrapUntrusted` label, and labels are
  // interpolated into `<untrusted source="…">` UNESCAPED — so a `"` or a
  // newline in a path breaks the delimiter the injection defence is built on.
  // See `SAFE_REPO_PATH_PATTERN`. Typed paths could never carry one; paths
  // recovered from a GitHub URL can, via `decodeURIComponent`.
  if (!SAFE_REPO_PATH_PATTERN.test(relPath)) return 'denied';
  const segments = relPath.split('/');
  // Any dot-segment: `.env`, `.github/…`, `.aws/credentials`. A leading dot is
  // the cheapest signal that a file is configuration rather than a plan.
  if (segments.some((seg) => seg.startsWith('.'))) return 'denied';
  if (DENIED_PATH_PATTERN.test(relPath)) return 'denied';
  const lower = relPath.toLowerCase();
  if (!ALLOWED_DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'ext';
  return 'ok';
}

/** Distinct candidate document paths named anywhere in the body, in order. */
export function candidateRepoPaths(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(REPO_PATH_PATTERN)) {
    const path = m[1];
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** Distinct external URLs named in the body. Recorded, never fetched. */
export function externalUrls(body: string): string[] {
  return [...new Set(body.match(EXTERNAL_URL_PATTERN) ?? [])];
}

/**
 * A GitHub URL that points at a file in THIS repo → the repo-relative path it
 * names. Anything else → `null`.
 *
 * Why this exists. `REPO_PATH_PATTERN` deliberately refuses to match a path
 * preceded by `/`, so it cannot mine paths out of arbitrary URLs — right in
 * general, and wrong for the one case that matters most: a PR body that links
 * its own plan as `github.com/<owner>/<repo>/blob/<ref>/docs/plans/x.md`. That
 * IS "a link to a plan or spec" by any reading, the file is sitting in the
 * local clone, and recording it as an unfetchable external link is a miss, not
 * a safety property. Seen on a real PR: twelve links, four of them pointing at
 * this repo's own `docs/plans/*.md`, none read.
 *
 * This is NOT external-URL fetching, which stays out of scope. Nothing is
 * requested over the network — the URL is only used to recover a path, which is
 * then subject to the same allowlist, denylist, clone check and attempt cap as
 * a path typed directly. A URL for a DIFFERENT repo, or any other host, returns
 * `null` and stays an unavailable external link.
 *
 * Two shapes, both anchored to the host so a lookalike domain cannot match:
 *   github.com/<owner>/<name>/blob/<ref>/<path>
 *   raw.githubusercontent.com/<owner>/<name>/<ref>/<path>
 * `<ref>` is a single segment, so a branch containing `/` resolves the wrong
 * path — it returns whatever follows the first segment, which then simply fails
 * the clone read and is reported as not found. Wrong-but-reported, never
 * invented.
 */
export function selfRepoPathFromUrl(url: string, repo: RepoRef): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const owner = repo.owner.toLowerCase();
  const name = repo.name.toLowerCase();
  const seg = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (parsed.hostname === 'github.com') {
    // owner / name / blob / ref / …path
    if (seg.length < 5 || seg[2] !== 'blob') return null;
    if (seg[0]?.toLowerCase() !== owner || seg[1]?.toLowerCase() !== name) return null;
    return seg.slice(4).join('/') || null;
  }
  if (parsed.hostname === 'raw.githubusercontent.com') {
    // owner / name / ref / …path
    if (seg.length < 4) return null;
    if (seg[0]?.toLowerCase() !== owner || seg[1]?.toLowerCase() !== name) return null;
    return seg.slice(3).join('/') || null;
  }
  return null;
}

/** The issue number a body CLOSES, by the strict keyword form. */
export function linkedIssueNumber(body: string): number | null {
  const m = body.match(LINKED_ISSUE_PATTERN);
  return m?.[1] ? Number(m[1]) : null;
}

export async function collectSources(input: CollectInput): Promise<CollectedSources> {
  const blocks: CollectedBlock[] = [];
  const sources: IntentSource[] = [];
  const missingContext: string[] = [];

  // ---- title: the one guaranteed input, and never a failure ----------------
  sources.push({ kind: 'pr_title', ref: input.title, status: 'used' });

  // ---- body ---------------------------------------------------------------
  const body = input.body?.trim() ? input.body.slice(0, MAX_PR_BODY_CHARS) : null;
  if (body) {
    blocks.push({ label: 'pr-body', text: body });
    sources.push({ kind: 'pr_body', ref: 'PR description', status: 'used' });
  } else {
    // Not an error — plenty of real PRs have no description. But it IS the
    // single strongest source, so its absence floors confidence downstream and
    // has to be visible on the card rather than inferred from a short summary.
    sources.push({
      kind: 'pr_body',
      ref: 'PR description',
      status: 'unavailable',
      note: 'this PR has no description',
    });
    missingContext.push('the PR has no description');
  }

  // ---- changed files + hunk headers (NO bodies) ---------------------------
  if (input.diff.files.length > 0) {
    blocks.push({ label: 'changed-files', text: renderChangedFiles(input.diff) });
    const hunks = input.diff.files.reduce((n, f) => n + f.hunks.length, 0);
    sources.push({
      kind: 'changed_files',
      ref: `${input.diff.files.length} file(s), ${hunks} hunk header(s)`,
      status: 'used',
    });
  } else {
    sources.push({
      kind: 'changed_files',
      ref: '0 file(s)',
      status: 'unavailable',
      note: 'no diff was available for this PR',
    });
    missingContext.push('no diff available');
  }

  // Everything below is named BY the body, so with no body there is nothing to
  // resolve and no gap to report.
  if (!body) return { blocks, sources, missingContext };

  // ---- linked issue --------------------------------------------------------
  const issueNumber = linkedIssueNumber(body);
  if (issueNumber !== null) {
    const ref = `#${issueNumber}`;
    try {
      const gh = await input.github();
      const issue = await gh.getIssue(input.repo, issueNumber);
      const text = [issue.title, (issue.body ?? '').slice(0, MAX_ISSUE_BODY_CHARS)]
        .filter((part) => part.length > 0)
        .join('\n\n');
      blocks.push({ label: 'linked-issue', text });
      sources.push({ kind: 'linked_issue', ref, status: 'used' });
    } catch (err) {
      // A 404, a revoked token, a rate limit — indistinguishable from here and
      // all the same thing to the classifier: this ticket is not readable.
      sources.push({
        kind: 'linked_issue',
        ref,
        status: 'unavailable',
        note: `could not be fetched (${(err as Error).message})`,
      });
      missingContext.push(`linked issue ${ref} could not be fetched`);
    }
  }

  // ---- links -------------------------------------------------------------
  // A link into THIS repo is resolved to a clone path and read below; every
  // other link is recorded and never fetched. No HTTP-fetch adapter exists in
  // this repo, and adding one to a service that consumes attacker-controlled PR
  // text is an SSRF surface, not a line item.
  const selfLinked: string[] = [];
  for (const url of externalUrls(body)) {
    const selfPath = selfRepoPathFromUrl(url, input.repo);
    if (selfPath) {
      selfLinked.push(selfPath);
      continue;
    }
    sources.push({
      kind: 'link',
      ref: url,
      status: 'unavailable',
      note: 'external links are not fetched',
    });
    missingContext.push(`the external link ${url} was not fetched`);
  }

  // ---- in-repo plan / spec files ------------------------------------------
  // Paths typed directly first, then paths recovered from this repo's own
  // GitHub URLs — a body that spells a path out is being more deliberate about
  // it than one that happens to link a file, and the read budget is small.
  const candidates = [...new Set([...candidateRepoPaths(body), ...selfLinked])];
  let attempts = 0;
  let read = 0;
  for (const relPath of candidates) {
    if (read >= MAX_REPO_FILES || attempts >= MAX_REPO_READ_ATTEMPTS) break;

    // The allowlist and the denylist are checked BEFORE the attempt, so a
    // rejected path costs no syscall and does not consume the attempt budget a
    // real document could have used.
    const verdict = classifyCandidatePath(relPath);
    if (verdict === 'ext') continue;
    if (verdict === 'denied') {
      sources.push({
        kind: 'repo_file',
        ref: relPath,
        status: 'unavailable',
        note: 'not an allowed document path',
      });
      missingContext.push(`the file ${relPath} was not read (not an allowed document path)`);
      continue;
    }

    if (input.clonePath === null) {
      sources.push({
        kind: 'repo_file',
        ref: relPath,
        status: 'unavailable',
        note: 'this repo has not been cloned',
      });
      missingContext.push(`the file ${relPath} could not be read (the repo has no local clone)`);
      continue;
    }

    attempts += 1;
    const content = await input.sourceReader.read(input.clonePath, relPath);
    if (content === null) {
      sources.push({
        kind: 'repo_file',
        ref: relPath,
        status: 'unavailable',
        note: 'not found in the repository',
      });
      missingContext.push(`the file ${relPath} was named but does not exist in the repo`);
      continue;
    }
    blocks.push({ label: `repo-file:${relPath}`, text: content.slice(0, MAX_REPO_FILE_BYTES) });
    sources.push({ kind: 'repo_file', ref: relPath, status: 'used' });
    read += 1;
  }

  return { blocks, sources, missingContext };
}
