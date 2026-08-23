import { z } from 'zod';
import type {
  PrMeta,
  PrDetail,
  IssueMeta,
  PrReviewComment,
} from './contracts/platform.js';

/**
 * Adapter interfaces. ALL external calls go behind these interfaces.
 * Real implementations live in `apps/api/src/adapters/*`; mock implementations
 * live alongside for tests/dev (Services depend on the interface, not the impl).
 */

// ---------- LLM ----------
export const ModelInfo = z.object({
  id: z.string(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  label: z.string().nullish(),
  created: z.number().int().nullish(),
  /** Pricing in USD per 1M tokens (when the provider exposes it, e.g. OpenRouter). */
  pricing: z
    .object({ promptPerM: z.number(), completionPerM: z.number() })
    .nullish(),
  /** Max context window in tokens (when the provider exposes it). */
  contextLength: z.number().int().nullish(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Cancellation. Aborting it must abort the in-flight HTTP request, not merely
   * stop the caller from awaiting it.
   *
   * This exists because `POST /runs/:id/cancel` used to be advisory: it marked
   * the row `cancelled` while the socket stayed ESTABLISHED and the tokens kept
   * being generated and billed. A provider that ignores this field turns cancel
   * back into a lie, so wire it into the SDK call.
   */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/**
 * Structured-output request. `schema` is a Zod schema; `schemaName` names the
 * tool / json_schema. `maxRetries` controls reprompt-on-error.
 */
export interface StructuredRequest<T> {
  model: string;
  schema: z.ZodType<T>;
  schemaName: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * OpenRouter session id — groups related generations (e.g. all map-reduce
   * chunks of one review) into a session in the OpenRouter dashboard. Sent as
   * the `session_id` body field; ignored by providers that don't support it.
   */
  sessionId?: string;
  /**
   * Cancellation. Aborting it must abort the in-flight HTTP request, not merely
   * stop the caller from awaiting it.
   *
   * This exists because `POST /runs/:id/cancel` used to be advisory: it marked
   * the row `cancelled` while the socket stayed ESTABLISHED and the tokens kept
   * being generated and billed. A provider that ignores this field turns cancel
   * back into a lie, so wire it into the SDK call.
   */
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  raw: string;
  attempts: number;
}

export interface LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter';
  listModels(): Promise<ModelInfo[]>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Embedder ----------
export interface Embedder {
  /** OpenAI text-embedding-3-small → 1536 dims. */
  embed(texts: string[]): Promise<number[][]>;
  readonly dims: number;
}

// ---------- GitHub (Octokit REST, thin) ----------
export interface RepoRef {
  owner: string;
  name: string;
}

export interface GitHubReviewPayload {
  body: string;
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  comments?: { path: string; line: number; body: string }[];
}

/** Create one standalone inline review comment (or a reply to a thread). */
export interface CreateReviewCommentInput {
  /** Head commit the comment pins to (GitHub requires commit_id). */
  commitId: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  body: string;
  /** When set, post as a reply to that comment's thread instead of a new one. */
  inReplyTo?: number;
}

export interface OpenPrPayload {
  title: string;
  head: string;
  base: string;
  body: string;
}

/** A single file to write in a commit (path relative to repo root + UTF-8 text). */
export interface CommitFile {
  path: string;
  contents: string;
}

export interface CommitFilesPayload {
  /** Branch to create-or-update with the commit (e.g. "devdigest/ci"). */
  branch: string;
  /** Base branch to fork from when `branch` does not yet exist (e.g. "main"). */
  base: string;
  message: string;
  files: CommitFile[];
}

export interface GitHubClient {
  listPullRequests(repo: RepoRef): Promise<PrMeta[]>;
  getPullRequest(repo: RepoRef, n: number): Promise<PrDetail>;
  postReview(repo: RepoRef, n: number, review: GitHubReviewPayload): Promise<{ id: string }>;
  /** List inline review comments on a PR (for the "Files changed" tab). */
  listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]>;
  /** Create one inline review comment (or reply) on a PR; returns the new comment. */
  createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment>;
  openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }>;
  /**
   * Commit `files` onto `branch` as ONE atomic commit (Git Data API: blobs →
   * tree → commit → ref). Creates the branch from `base` if missing, else
   * fast-forwards it. Idempotent: re-publishing just adds a new commit.
   */
  commitFiles(repo: RepoRef, payload: CommitFilesPayload): Promise<{ branch: string }>;
  /** The open PR whose head is `branch`, if any (so re-publish reuses it). */
  findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null>;
  getIssue(repo: RepoRef, n: number): Promise<IssueMeta>;
  /** GET /user — for "posting as @user". */
  currentLogin(): Promise<string>;
}

// ---------- Git (simple-git, heavy) ----------
export interface CloneOptions {
  depth?: number;
  branch?: string;
}

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Lines present in the *new* file covered by this hunk (for grounding). */
  newLineNumbers: number[];
}

export interface UnifiedDiff {
  raw: string;
  files: { path: string; additions: number; deletions: number; hunks: DiffHunk[] }[];
}

export interface BlameLine {
  line: number;
  sha: string;
  author: string;
  date: string;
  summary: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitClient {
  clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }>;
  fetchPullHead(repo: RepoRef, n: number): Promise<void>;
  /**
   * Resync an already-cloned repo to the tip of `branch`: fetch from origin and
   * advance the local working tree to `origin/<branch>`. Unlike `clone`'s bare
   * `fetch` (which only moves remote-tracking refs), this moves local HEAD so a
   * subsequent index reflects the latest code. Returns the new HEAD sha.
   */
  sync(repo: RepoRef, branch: string): Promise<{ head: string }>;
  currentHead(repo: RepoRef): Promise<string>;
  diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff>;
  /**
   * Names of files changed between two commits (`git diff --name-only base..head`).
   * Two-dot form is intentional — we want files reachable from `head` but not `base`,
   * matching the incremental indexer's "what moved since last_indexed_sha?" semantics.
   * Returns an empty array when the two refs resolve to the same commit.
   */
  diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]>;
  blame(repo: RepoRef, path: string): Promise<BlameLine[]>;
  log(repo: RepoRef, path?: string): Promise<GitCommit[]>;
  readFile(repo: RepoRef, path: string): Promise<string>;
  clonePathFor(repo: RepoRef): string;
}

// ---------- CodeIndex (ripgrep + tree-sitter) ----------
export interface CodeMatch {
  path: string;
  line: number;
  text: string;
}

export interface CodeSymbol {
  path: string;
  name: string;
  kind: string;
  line: number;
}

export interface CodeReference {
  fromPath: string;
  toSymbol: string;
  line: number;
}

export interface CodeIndex {
  grep(repo: RepoRef, pattern: string): Promise<CodeMatch[]>;
  symbols(repo: RepoRef): Promise<CodeSymbol[]>;
  references(repo: RepoRef, symbol: string): Promise<CodeReference[]>;
}

// ---------- SourceReader (repo-relative file reads out of a clone) ----------
/**
 * Reading one file out of a cloned repo, behind a port.
 *
 * This is the port `repo-intel/service.ts` has been documenting as KNOWN DEBT:
 * ring-2 code needs the text of a file in the clone, and until now the only way
 * to get it was `node:fs` directly, with an eslint-disable and a written excuse.
 * The Conventions Extractor needs the same thing, so it was built rather than
 * excused a second time.
 *
 * `read` answers `null` for every "you cannot have this" — absent, a directory,
 * unreadable, or a path that tries to leave the clone. Callers treat a missing
 * file as data (a config that isn't there, a sample that moved), never as an
 * error, so a throw here would only ever be caught and discarded.
 *
 * repo-intel is NOT migrated onto this yet; its four raw imports stay until
 * someone does that as its own change.
 *
 * **`list` reverses a decision this repo recorded in writing.**
 * `server/docs/specs/04-conventions.md:236-238` says, in as many words, that
 * "`SourceReader` stays a one-method port instead of growing a directory walk."
 * That was right while the only consumer was the Conventions Extractor, which
 * samples files repo-intel has already ranked and never needs to discover any.
 * SPEC-06's import picker cannot exist without discovery: it offers a person the
 * `.md` files that are actually in their clone, so the walk feeds a PICKER, not a
 * prompt, and nothing downstream of it is a model call.
 *
 * It belongs on the PORT rather than inside `modules/context/` because
 * `modules/repo-intel/pipeline/walk.ts:23-32` already carries two
 * `eslint-disable no-restricted-imports` whose own comment names extracting
 * exactly this port as the payoff. Putting the walk anywhere else would add a
 * seventh raw-`fs` excuse to a codebase that has written down that it will not
 * add more. This reversal is recorded in three places, because a negative
 * decision written into a comment has to be reversed everywhere it is written
 * down: here, in SPEC-06's *Inputs and provenance*, and in the PR body.
 */
export interface SourceReader {
  /**
   * UTF-8 contents of `relPath` inside `clonePath`, or `null`.
   *
   * `relPath` MUST stay inside the clone: an absolute path, or one that escapes
   * via `..`, answers `null` rather than reading it. No caller passes an
   * untrusted path today — the model only ever names files it was shown — but a
   * port that can be talked out of its own root is a directory traversal
   * waiting for its first careless caller.
   */
  read(clonePath: string, relPath: string): Promise<string | null>;

  /**
   * Repo-relative paths of the files under `clonePath` whose extension is in
   * `opts.extensions`, forward-slash normalised and sorted alphabetically, each
   * with its size in bytes.
   *
   * The SIZE comes from the directory entry, not from reading the file, and that
   * is what lets a caller refuse an oversized file without ever holding it in
   * memory. A `list` that returned paths alone would force every caller to read
   * first and judge afterwards — which is a heap exhaustion waiting for the
   * first hostile clone, since a clone is content an outsider influences.
   *
   * The sort happens BEFORE the cap, so `maxEntries` always returns the
   * alphabetically first N rather than whatever the filesystem handed back
   * first — a list that reshuffles between two calls is a list a person cannot
   * work through. `truncated` says the cap actually bit, and is a returned fact
   * rather than a length comparison the caller re-derives from a constant it
   * would then own a second copy of.
   *
   * Answers `{ entries: [], truncated: false }` for a root that is absent or
   * unreadable, for the same reason `read` answers `null`: a repo with no clone
   * yet is data, not a failure, and the picker renders an empty list.
   *
   * Directories in `EXCLUDED_DIRS` are never descended into, and every entry is
   * re-checked against the resolved root — a SYMLINKED directory can walk out of
   * a clone exactly as a symlinked file can be read out of one.
   */
  list(
    clonePath: string,
    opts: { extensions: string[]; maxEntries: number },
  ): Promise<{ entries: Array<{ path: string; bytes: number }>; truncated: boolean }>;
}

// ---------- Auth (pluggable; MVP = LocalNoAuthProvider) ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
}

export interface AuthProvider {
  currentUser(req: unknown): Promise<AuthUser>;
  currentWorkspace(req: unknown): Promise<AuthWorkspace>;
}

// ---------- Secrets (pluggable; MVP = LocalSecretsProvider) ----------
export type SecretKey =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'GITHUB_TOKEN'
  | 'DATABASE_URL'
  | (string & {});

export interface SecretsProvider {
  get(key: SecretKey): Promise<string | undefined>;
  /**
   * Persist a secret (BYO key entered via the UI). Optional — read-only
   * providers (e.g. the env-only MVP backend) may omit it.
   */
  set?(key: SecretKey, value: string): Promise<void>;
}
