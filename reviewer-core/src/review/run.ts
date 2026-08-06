import type {
  Finding,
  LLMProvider,
  PromptAssembly,
  Review,
  RunEventKind,
  UnifiedDiff,
} from '@devdigest/shared';
import { z } from 'zod';
import { Finding as FindingSchema, Review as ReviewSchema } from '@devdigest/shared';
import { assemblePrompt, type PromptSection } from '../prompt.js';
import { groundFindings, groundingSummary } from '../grounding.js';
import { reduceReviews, scoreFromFindings, sliceDiff, type ReviewOf } from './reduce.js';
import { applyScopeFilter, type ScopedFinding } from './scope.js';

/**
 * reviewPullRequest — the review engine entry point.
 *
 * given (diff + resolved agent inputs + injected LLM) → grounded Review.
 *
 * This is the pure core lifted out of the server's `ReviewService.runOneAgent`:
 * assemble prompt → single-pass OR map-reduce per file → reduce → SHARED
 * citation-grounding gate. It performs NO I/O beyond the injected LLM provider
 * (no DB, GitHub, fs, memory retrieval, intent, or persistence) — those stay in
 * the caller (server persists + streams SSE; runner posts + writes an artifact).
 *
 * Skill bodies / memory / specs are RESOLVED strings here: the caller turns
 * AgentManifest skill slugs into bodies (DB in the studio, fs in the runner).
 */

/** Default map-reduce threshold (matches the server's FILE_MAP_THRESHOLD_LINES). */
export const DEFAULT_MAP_THRESHOLD_LINES = 400;
/** Default structured-output reprompt retries (matches REVIEW_MAX_RETRIES). */
export const DEFAULT_REVIEW_MAX_RETRIES = 2;

export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';
export type ReviewMode = 'single-pass' | 'map-reduce';

/** Progress event emitted during a review (server → SSE bus, runner → log). */
export interface ReviewEvent {
  kind: RunEventKind;
  msg: string;
  data?: unknown;
}

export interface ReviewInput {
  /** Agent system prompt (trusted). */
  systemPrompt: string;
  /** Model id understood by the injected provider (e.g. 'deepseek/deepseek-v4-flash'). */
  model: string;
  /** The PR's unified diff (already parsed; hunks carry new-side line numbers). */
  diff: UnifiedDiff;
  /** Injected LLM provider (OpenRouter in CI, OpenAI/Anthropic in the studio). */
  llm: LLMProvider;
  /** 'auto' (default) picks single-pass unless the diff is large + multi-file. */
  strategy?: ReviewStrategy;
  /** Resolved skill bodies (NOT slugs). */
  skills?: string[];
  /** Curated memory items. */
  memory?: string[];
  /** Project-context spec chunks (untrusted; delimiter-wrapped downstream). */
  specs?: string[];
  /**
   * Optional callers-of-changed-symbols digest (T1.3). Untrusted; rendered
   * before the diff section. Empty/undefined → section omitted.
   */
  callers?: string;
  /**
   * Optional repo skeleton / map (T3). Untrusted; rendered before the project
   * context section. Empty/undefined → section omitted.
   */
  repoMap?: string;
  /** PR author's description/body (untrusted; truncated + delimiter-wrapped in
      the prompt). Empty/undefined → section omitted. */
  prDescription?: string;
  /**
   * The derived PR intent (L03), already rendered by the caller. Untrusted;
   * wrapped and slotted by `assemblePrompt`, which also appends `SCOPE_RULE` to
   * the system message when this is set. Empty/undefined → the prompt is
   * byte-identical to the pre-L03 one and no scope tagging is asked for.
   */
  intent?: string;
  /**
   * Arm the deterministic scope gate. Only ever true when the CALLER has
   * established that the intent was well sourced — see `scope.ts` for the three
   * conditions and why the default direction is off.
   *
   * Meaningless without `intent`: with no intent there is no scope rule, so
   * nothing is tagged and nothing can be dropped.
   */
  scopeFilter?: boolean;
  /** Task framing line, e.g. "Review PR #482 …". */
  task?: string;
  /** Override the structured-output retry budget. */
  maxRetries?: number;
  /** Override the map-reduce line threshold. */
  mapThresholdLines?: number;
  /**
   * OpenRouter session id — forwarded on every LLM call so all chunks of this
   * review group into one session in the OpenRouter dashboard.
   */
  sessionId?: string;
  /** Progress sink. */
  onEvent?: (e: ReviewEvent) => void;
  /**
   * Cancellation checkpoint, called before each (expensive) chunk LLM call.
   * Supply a function that THROWS to abort mid-run (the caller owns the error
   * type, e.g. the server's RunCancelledError); the engine stays agnostic.
   *
   * This only fires BETWEEN chunks. To interrupt a call already in flight, pass
   * `signal` as well — the two are complementary, not alternatives.
   */
  checkCancelled?: () => void;
  /**
   * Cancellation for the in-flight request, forwarded to every LLM call.
   *
   * `checkCancelled` alone cannot stop a single-pass review: there is one chunk,
   * so the checkpoint runs once, before the call that then takes as long as it
   * takes. Runs of 945 s and 674 s were observed against an 8–99 s norm, with
   * cancel unable to touch them. Passing a signal makes cancel actually cancel.
   */
  signal?: AbortSignal;
}

export interface ReviewOutcome {
  /** The reduced, GROUNDED review (findings that survived the citation gate). */
  review: Review;
  /** Human-readable grounding summary, e.g. "3/4 passed". */
  grounding: string;
  /** Findings dropped by grounding, with reasons (for logs / "never go silent"). */
  dropped: { finding: Finding; reason: string }[];
  /** Which path ran. */
  mode: ReviewMode;
  /** Prompt assembly (for the run trace). Single-pass: the one call; map-reduce: the whole-diff assembly. */
  assembly: PromptAssembly;
  /**
   * Per-slot manifest of the same assembly, for SAFE logging — names, trust
   * classes, origins and sizes. The engine builds it and logs nothing; the
   * server measures and emits it (`platform/prompt-log.ts`). Same slots as
   * `assembly`, described instead of dumped.
   */
  sections: PromptSection[];
  /** Per-chunk labels (for the run trace's tool_calls). */
  chunks: { label: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Joined raw model outputs (for the run trace). */
  raw: string;
}

/**
 * The scope tag, and where it does NOT go.
 *
 * `scope` is ENGINE-LOCAL: it is not on the shared `Finding` contract, has no
 * `findings.scope` column, and never reaches the database. Persisting it would
 * cascade through the contract, both vendored copies, a column, a fourth CHECK,
 * a migration, `insertFindings`, the DTO and the client type — far more than the
 * one badge it buys. `insertFindings` maps fields explicitly, so the extra
 * property cannot reach a table by accident even if someone forgets.
 *
 * `.nullish()` matters for the fixtures: every existing canned review parses
 * unchanged against the extended schema, so `MockLLMProvider` does not start
 * throwing `fixture failed schema` across the suite.
 */
const ScopeTag = z.enum(['in_scope', 'out_of_scope']);
const ScopedFindingSchema = FindingSchema.extend({ scope: ScopeTag.nullish() });
const ScopedReviewSchema = ReviewSchema.extend({ findings: z.array(ScopedFindingSchema) });

function selectMode(strategy: ReviewStrategy, diff: UnifiedDiff, threshold: number): ReviewMode {
  if (strategy === 'single-pass') return 'single-pass';
  if (strategy === 'map-reduce') return diff.files.length > 1 ? 'map-reduce' : 'single-pass';
  // auto: map-reduce only when the diff is both large AND multi-file (else 1 call).
  const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return totalLines > threshold && diff.files.length > 1 ? 'map-reduce' : 'single-pass';
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const threshold = input.mapThresholdLines ?? DEFAULT_MAP_THRESHOLD_LINES;
  const maxRetries = input.maxRetries ?? DEFAULT_REVIEW_MAX_RETRIES;
  const mode = selectMode(input.strategy ?? 'auto', input.diff, threshold);
  const emit = (kind: RunEventKind, msg: string, data?: unknown) =>
    input.onEvent?.({ kind, msg, data });

  const promptParts = {
    system: input.systemPrompt,
    skills: input.skills,
    memory: input.memory,
    specs: input.specs,
    callers: input.callers,
    repoMap: input.repoMap,
    prDescription: input.prDescription,
    intent: input.intent,
    task: input.task,
  };

  // Ask for the tag only when there is an intent to tag against; otherwise this
  // is the untouched `ReviewSchema` and the call is identical to the pre-L03 one.
  const hasIntent = Boolean(input.intent && input.intent.trim().length > 0);
  const reviewSchema = hasIntent ? ScopedReviewSchema : ReviewSchema;

  // Whole-diff assembly is the trace default; overwritten below for single-pass.
  const whole = assemblePrompt({ ...promptParts, diff: input.diff.raw });
  let assembly: PromptAssembly = whole.assembly;
  // The manifest describes the WHOLE-diff assembly in both modes, deliberately.
  // In map-reduce the model sees one slice per call, so a per-chunk manifest
  // would be N near-identical records differing only in the diff slot; the
  // whole-diff one answers "what was this run built from" once.
  let sections: PromptSection[] = whole.sections;

  const chunks =
    mode === 'map-reduce'
      ? input.diff.files.map((f) => ({ label: f.path, diffText: sliceDiff(input.diff, f.path) }))
      : [{ label: 'all files', diffText: input.diff.raw }];

  emit(
    'info',
    mode === 'map-reduce'
      ? `Large diff → map-reduce over ${input.diff.files.length} files`
      : `Reviewing ${input.diff.files.length} changed file(s) in one pass`,
  );

  const partials: ReviewOf<ScopedFinding>[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd: number | null = 0;
  const raws: string[] = [];

  for (const chunk of chunks) {
    // Cancellation checkpoint — stop before the next (expensive) LLM call.
    input.checkCancelled?.();
    // 'map:' prefix only for the map-reduce path (one call per file). In
    // single-pass there is exactly one chunk (the whole diff) — don't mislabel it.
    emit(
      'tool',
      mode === 'map-reduce' ? `map: reviewing ${chunk.label}` : `Reviewing ${chunk.label} in one pass`,
      { file: chunk.label },
    );
    const a = assemblePrompt({ ...promptParts, diff: chunk.diffText });
    if (mode === 'single-pass') {
      assembly = a.assembly;
      sections = a.sections;
    }
    const res = await input.llm.completeStructured<ReviewOf<ScopedFinding>>({
      model: input.model,
      schema: reviewSchema,
      schemaName: 'Review',
      messages: a.messages,
      maxRetries,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
    raws.push(res.raw);
    partials.push(res.data);
    emit('result', `${chunk.label}: ${res.data.findings.length} candidate finding(s)`);
  }

  const merged = reduceReviews(partials);
  emit(
    'result',
    `Reduced to ${merged.findings.length} finding(s); verdict=${merged.verdict}, score=${merged.score}`,
  );

  // SHARED citation-grounding gate (the only post-step; not duplicated per strategy).
  const ground = groundFindings(merged.findings, input.diff);
  const grounding = groundingSummary(ground);
  for (const d of ground.dropped) {
    emit('info', `grounding dropped "${d.finding.title}": ${d.reason}`);
  }
  emit('result', `Citation grounding: ${grounding}`);

  // L03 — the scope gate, AFTER grounding and BEFORE the score. Order is the
  // invariant: grounding still drops every uncited finding, and the score below
  // is still computed from whatever survived both gates. Disarmed unless the
  // caller established the intent was well sourced (`scope.ts`).
  const scopeArmed = input.scopeFilter === true;
  const scoped = applyScopeFilter(ground.kept, { enabled: scopeArmed });
  for (const d of scoped.dropped) {
    emit('info', `scope filter dropped "${d.finding.title}": ${d.reason}`);
  }
  // Report whenever the gate was ARMED, not only when it dropped something —
  // the same contract `Citation grounding: N/M passed` honours one line up.
  // Silence on a clean pass is indistinguishable from a gate that never ran,
  // and "did the filter actually engage?" is exactly the question a reader of
  // this log has. The disarmed case is announced by the caller instead, because
  // only the caller knows WHY it was disarmed.
  if (scopeArmed) {
    emit(
      'result',
      `Scope filter: ${scoped.kept.length}/${ground.kept.length} kept` +
        (scoped.dropped.length === 0 ? ' — every finding was in scope' : ''),
    );
  }

  // Score is derived from the findings that SURVIVED both gates (not the model's
  // self-reported number, and not the pre-grounding set) so the score, the
  // findings list, and the deterministic event always agree.
  return {
    review: { ...merged, findings: scoped.kept, score: scoreFromFindings(scoped.kept) },
    grounding,
    dropped: ground.dropped,
    mode,
    assembly,
    sections,
    chunks: chunks.map((c) => ({ label: c.label })),
    tokensIn,
    tokensOut,
    costUsd,
    raw: raws.join('\n---\n'),
  };
}
