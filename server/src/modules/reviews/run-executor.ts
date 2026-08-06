import type { Container } from '../../platform/container.js';
import type {
  PrIntentRecord,
  Provider,
  Review,
  RunTrace,
  ToolCall,
  TraceSkill,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, countBlockers, renderSkillBlock } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
// SANCTIONED — onion §15 names this file in its exemptions list: it imports
// db/schema in TYPE POSITION ONLY, to describe a repo row it passes straight
// through. Marked here rather than silenced globally so the next person to
// change this signature sees the standing instruction: prefer a contract type.
// eslint-disable-next-line no-restricted-imports
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY, RUN_DEADLINE_MS } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/**
 * Did this error come from an aborted request?
 *
 * Matched structurally rather than with `instanceof`, because the abort travels
 * up through whichever SDK made the call — OpenAI's `APIUserAbortError`,
 * Anthropic's equivalent, or a bare `DOMException` named `AbortError` — and none
 * of them is a class this module should be importing (onion §5: library error
 * classes do not travel inward).
 */
function isAbortError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (!e) return false;
  return (
    e.name === 'AbortError' ||
    e.name === 'APIUserAbortError' ||
    /aborted|abort(ed)? by/i.test(e.message ?? '')
  );
}

/**
 * The shared pre-work every queued agent reads: one derivation, whether THIS
 * trigger paid for it, and how long the call took.
 */
type SharedIntent = { intent?: PrIntentRecord; reused: boolean; deriveMs: number };

/**
 * The `derive_intent` entry for a run's trace, or nothing when no intent was
 * derived.
 *
 * `meta` LEADS WITH "cheap classifier" for the same reason the Live Log lines
 * carry their role: next to a `review_file` entry whose model is
 * `deepseek-v4-flash`, the slug `deepseek-v4-flash-0731` alone does not tell a
 * reader these were two different passes on two different models.
 */
function intentToolCalls(shared: SharedIntent): ToolCall[] {
  const rec = shared.intent;
  if (!rec) return [];
  // A REUSED derivation cost this run nothing. The record still carries the
  // tokens and dollars of whichever run first derived it, so printing them here
  // would bill every later run for a model call it never made — and a reader
  // summing `derive_intent` across a PR's traces would multiply one classifier
  // call by the number of reviews. Say "reused" and print no figures.
  const usage = shared.reused
    ? 'reused — billed to an earlier run'
    : [
        rec.provider,
        `${rec.tokens_in ?? 0} in / ${rec.tokens_out ?? 0} out`,
        rec.cost_usd == null ? 'cost unknown' : `$${rec.cost_usd.toFixed(6)}`,
      ].join(' · ');
  return [
    {
      tool: 'derive_intent',
      args: rec.model,
      meta: ['cheap classifier', usage, `confidence=${rec.confidence}`].join(' · '),
      // Reuse is a database read, not the original derivation's latency.
      ms: shared.deriveMs,
    },
  ];
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            // null, not 0: the run never reached the model, so its cost is
            // UNKNOWN — the badge must read "—", never "$0.00".
            costUsd: null,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // L03 — shared pre-work, derived ONCE and read by every agent queued in this
    // trigger. It sits here, between the diff load and the agent loop, for the
    // reason `run-logger.ts` gives for the fan-out existing at all: "shared
    // pre-work (diff/intent)". A three-agent run pays for one derivation, and
    // all three Live Logs and persisted traces carry it.
    //
    // BEST-EFFORT, and wrapped SEPARATELY from the diff load above on purpose:
    // the diff's catch calls `failAll`, which fails every queued run. A review
    // must never fail because intent derivation failed — the slot is simply
    // omitted, exactly as `callers` and `repoMap` do below.
    const shared = await this.deriveIntent(workspaceId, pull, repo, diff, runLog);

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          runLog,
          shared,
        );
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /**
   * L03 — derive (or reuse) this PR's intent, once, for every queued agent.
   *
   * Reached through `container.intent`, never by importing `../intent/service.js`
   * — that is a sibling module and onion §11 makes it private; the container is
   * the sanctioned route.
   *
   * Returns `{intent: undefined}` on ANY failure, having said so in the log. The
   * derivation carries its own 60 s timeout because the agent loop below is
   * sequential, so a hung classifier would delay every queued run.
   */
  private async deriveIntent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<SharedIntent> {
    const t0 = Date.now();
    try {
      const outcome = await runLog.step(
        'Deriving PR intent',
        () =>
          this.container.intent.deriveIfStale(
            {
              workspaceId,
              pull,
              repo: {
                owner: repo.owner,
                name: repo.name,
                fullName: repo.fullName,
                clonePath: repo.clonePath,
              },
              diff,
            },
            runLog,
          ),
        { kind: 'tool' },
      );
      return {
        intent: outcome.record,
        reused: outcome.reused,
        deriveMs: Date.now() - t0,
      };
    } catch (err) {
      // `runLog.step` already emitted the error line; this says what it COSTS,
      // which is the part a reader of the Live Log needs.
      runLog.info(
        `Intent unavailable — the review continues without it (${(err as Error).message})`,
      );
      return { reused: false, deriveMs: Date.now() - t0 };
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    diff: UnifiedDiff,
    agent: AgentRow,
    runId: string,
    parentLog: RunLogger,
    shared: SharedIntent,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });

    // "REVIEW model … (main pass)" is not decoration. The intent classifier's
    // default (`deepseek/deepseek-v4-flash-0731`) differs from the seeded
    // reviewer agents' model (`deepseek/deepseek-v4-flash`) by a suffix alone, so
    // a log printing two near-identical slugs does not let a reader verify that
    // the classifier ran on a separate cheap model. The ROLE labels are what make
    // that checkable at a glance; drop them and the gap re-opens.
    runLog.info(`Starting review with agent "${agent.name}"`);
    runLog.tool(`REVIEW model: ${agent.provider}/${agent.model} (main pass)`);

    // Two things can end this run early, and both abort the SAME controller so
    // the provider request is actually torn down rather than merely un-awaited:
    //   - the user cancelling (runBus.cancel → registerAborter's controller)
    //   - the run deadline below
    // `checkCancelled` stays as the between-chunk checkpoint; it is what turns a
    // cancel into a clean RunCancelledError rather than a raw abort error.
    const aborter = new AbortController();
    this.container.runBus.registerAborter(runId, aborter);
    const deadline = setTimeout(() => aborter.abort(), RUN_DEADLINE_MS);

    try {
      // Resolve the agent's LLM provider. (container.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.container.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // L02 — the agent's knowledge layer. Two filters, meaning different
      // things: `agent_skills` decides whether this skill is attached to THIS
      // agent (and in what order), `skills.enabled` is the workspace-wide master
      // switch. A disabled skill loads for nobody.
      //
      // This used to read "disabled → absent from the log AND the trace". Half of
      // that is reversed: it is still absent from the trace and the prompt, but
      // the LOG now says so out loud, because a silent log is what makes "why is
      // my skill not in the prompt?" unanswerable from the place people look.
      // Absent-from-the-trace is a contract (the UI hides the row); silence in
      // the log was never a feature.
      const { skills, traceSkills } = await this.resolveSkills(agent.id, runLog);

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // Claim + provenance refs only — no fetched issue body, no plan-file
      // content, no diff. This exact string is what lands in the trace's
      // `prompt_assembly.intent`, so what is safe to log is what is sent.
      const intentBlock = shared.intent
        ? this.container.intent.renderIntentBlock(shared.intent)
        : undefined;
      const scopeFilter = shared.intent
        ? this.container.intent.scopeFilterArmed(shared.intent)
        : false;
      if (shared.intent && !scopeFilter) {
        runLog.info(
          'Scope filter disarmed — the intent is not sourced well enough to suppress a finding',
        );
      }

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // L02 — passed only when the agent has enabled skills linked, so an
        // agent with none gets a prompt byte-identical to the pre-L02 one.
        ...(skills.length > 0 ? { skills } : {}),
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // L03 — the derived intent, same omit-when-empty contract as every slot
        // above: no intent ⇒ no `## PR intent` section, no SCOPE_RULE, and a
        // prompt byte-identical to the pre-L03 one.
        ...(intentBlock ? { intent: intentBlock } : {}),
        // Armed only when the derivation had substantive sources, no missing
        // context and was not self-reported low. The decision lives in the intent
        // service (reached via the container, not a sibling import) because it is
        // a judgement about provenance, which the engine cannot see.
        ...(scopeFilter ? { scopeFilter: true } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
        // Reaches the SDK call itself, so cancelling closes the socket instead
        // of leaving the generation running (and billing) unobserved.
        signal: aborter.signal,
      });
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      const keptFindings = outcome.review.findings;
      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      // ---- Persist the whole result atomically ------------------------------
      // Four writes, ONE business fact: "this agent reviewed this PR". Run
      // separately they can half-land — a crash after insertReview leaves a
      // review with no findings and a score computed from nothing, which the UI
      // renders as a confident clean bill of health. The service owns this
      // boundary because it is the layer that knows the four belong together
      // (onion §8); the repository methods just accept the tx.
      let settled = false;
      const { review, findingRows } = await this.container.db.transaction(async (tx) => {
        const review = await this.repo.insertReview(
          {
            workspaceId,
            prId: pull.id,
            agentId: agent.id,
            runId,
            kind: 'review',
            verdict: outcome.review.verdict,
            summary: outcome.review.summary,
            score: outcome.review.score,
            model: agent.model,
          },
          tx,
        );
        const findingRows = await this.repo.insertFindings(review.id, keptFindings, tx);

        // Mark the commit this review ran against so the PR list can tell
        // reviewed / needs-review (head moved) / stale apart.
        await this.repo.markReviewed(pull.id, pull.headSha, tx);

        settled = await this.repo.completeAgentRun(
          runId,
          {
            status: 'done',
            durationMs,
            tokensIn,
            tokensOut,
            costUsd,
            findingsCount: findingRows.length,
            grounding,
            score: outcome.review.score,
            blockers,
            error: null,
          },
          tx,
        );
        return { review, findingRows };
      });
      runLog.result(`Persisted review ${review.id} with ${findingRows.length} finding(s)`);

      // The run reached a terminal status while this call was still in flight —
      // almost always a user cancel, which cannot abort the provider request.
      // The findings above are still persisted and still real; what must NOT
      // happen is the row flipping back to `done` and being billed.
      if (!settled) {
        runLog.info(
          'Run had already been cancelled or reaped — keeping that status instead of marking it done',
        );
      }

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
          // Omitted (not `[]`) when nothing loaded, so the trace UI's "Skills
          // loaded" row is absent rather than empty — same distinction the
          // prompt makes by omitting the section.
          ...(traceSkills.length > 0 ? { skills: traceSkills } : {}),
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: findingRows.length,
          grounding,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: [
          // The classifier's call, ABOVE the review's, so the trace shows the
          // two passes in the order they happened. This is what makes "the log
          // shows two separate calls" checkable in the UI and not just in
          // stdout. `ToolCall.meta` is a free-form string, so the model, the
          // tokens and the cost of the cheap pass are all visible with NO
          // contract change.
          ...intentToolCalls(shared),
          ...outcome.chunks.map((c) => ({
            tool: 'review_file',
            args: c.label,
            meta: outcome.mode,
            ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
          })),
        ],
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      runLog.info('Run complete; trace persisted');
      await this.repo.saveRunTrace(runId, trace);
      this.container.runBus.complete(runId);

      return { review, findings: findingRows, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      //
      // Three ways to get here, and they must not be conflated:
      //   - RunCancelledError — the between-chunk checkpoint saw the cancel flag
      //   - an abort while the flag is set — the socket was torn down by cancel
      //   - an abort with no flag — the deadline fired, which is a FAILURE and
      //     needs to say so, not masquerade as something the user asked for
      const abortedInFlight = isAbortError(err);
      const cancelled =
        err instanceof RunCancelledError ||
        (abortedInFlight && this.container.runBus.isCancelled(runId));
      const timedOut = abortedInFlight && !cancelled;

      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled
        ? 'Cancelled by user'
        : timedOut
          ? `Run exceeded the ${Math.round(RUN_DEADLINE_MS / 60000)}-minute deadline and was aborted`
          : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          // Unknown, not free: a run that failed or was cancelled mid-flight may
          // still have burned tokens we can no longer account for.
          costUsd: null,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    } finally {
      // Always: an un-cleared 10-minute timer keeps the process alive after a
      // fast run, and would abort a controller nobody is listening to.
      clearTimeout(deadline);
    }
  }

  /**
   * Resolve the agent's knowledge layer: linked skills, in `agent_skills.order`,
   * filtered to the ones globally enabled, rendered into prompt blocks and
   * priced.
   *
   * `renderSkillBlock` comes from the engine so the studio and the CI runner
   * render the same skill identically — a CI review that can't be compared to a
   * local one is worse than no CI review.
   *
   * Tokens are counted on the RENDERED block, not the raw body, so the figure in
   * the trace is what the model was actually sent. Best-effort by construction:
   * `Tokenizer` falls back to a chars/4 heuristic rather than throwing, because a
   * token count is reporting — it must never be the reason a review fails.
   */
  private async resolveSkills(
    agentId: string,
    runLog: RunLogger,
  ): Promise<{ skills: string[]; traceSkills: TraceSkill[] }> {
    const links = await this.agents.linkedSkills(agentId);
    // No links at all — the agent was never given a knowledge layer, so there is
    // nothing to report. Silence is the correct log here, and the ONLY case
    // where it is.
    if (links.length === 0) return { skills: [], traceSkills: [] };

    const active = links.filter((l) => l.skill.enabled);
    const skipped = links.length - active.length;

    // Every linked skill is switched off at the workspace level. This is exactly
    // the state that prompts "why is my skill not in the prompt?", so the run log
    // has to answer it — returning early without a line left the question
    // unanswerable from the one place a person looks for the answer.
    if (active.length === 0) {
      runLog.info(`Loaded 0 skill(s) — ${skipped} linked but disabled`);
      return { skills: [], traceSkills: [] };
    }

    const skills: string[] = [];
    const traceSkills: TraceSkill[] = [];
    for (const { skill } of active) {
      const block = renderSkillBlock(skill.name, skill.body);
      skills.push(block);
      traceSkills.push({
        name: skill.name,
        version: skill.version,
        tokens: this.container.tokenizer.count(block),
      });
    }

    const total = traceSkills.reduce((n, s) => n + s.tokens, 0);
    runLog.info(
      `Loaded ${active.length} skill(s) (${total.toLocaleString('en-US')} tokens)` +
        (skipped > 0 ? ` — ${skipped} linked but disabled` : ''),
    );
    return { skills, traceSkills };
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: { system: agent.systemPrompt, skills: null, memory: null, specs: null, user: '' },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
