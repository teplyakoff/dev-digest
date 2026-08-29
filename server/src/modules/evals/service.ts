import {
  reviewPullRequest,
  scoreEvalBatch,
  scoreEvalCase,
  type EvalCaseResult,
  type ReviewOutcome,
} from '@devdigest/reviewer-core';
import type {
  CreateEvalCaseFromFinding,
  EvalBatchCompare,
  EvalBatchRecord,
  EvalCaseRecord,
  EvalCaseUpsert,
  EvalDashboard,
  EvalRunRecord,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { RunLogger, type PinoLike } from '../../platform/run-logger.js';
import { EvalRepository } from './repository.js';
import {
  EvalInvariantError,
  buildEvalReviewInput,
  costDelta,
  evalCaseName,
  evalTraceLine,
  expectationForFinding,
  expectedOutputFor,
  metricDelta,
  parseExpectedOutput,
  regressionAlert,
  sumCaseCosts,
  toBatchDto,
  toCaseDto,
  toFileDiff,
  toRunDto,
  toTrendPoint,
  type EvalBatchRow,
} from './helpers.js';
import {
  BATCH_HISTORY_LIMIT,
  CASE_TIMEOUT_MS,
  NO_DIFF_MESSAGE,
  RECENT_RUNS_LIMIT,
  REGRESSION_THRESHOLD,
  TREND_LIMIT,
} from './constants.js';

/**
 * L06 / SPEC-08 — the eval pipeline's use-case service.
 *
 * ## An eval run is NOT a review run
 *
 * It calls `reviewPullRequest` directly and deliberately bypasses
 * `ReviewService.runReview` / `ReviewRunExecutor.runOneAgent`: no `reviews` row,
 * no `findings` row, no `agent_runs` row, no SSE stream (AC-29). That is not an
 * optimisation — it is what makes the harness measure the AGENT rather than the
 * review pipeline around it, and it is why AC-44/AC-45 (exactly three agent
 * inputs, five named inputs absent) are achievable at all.
 *
 * ## Two entry points into one batch, on purpose
 *
 * `startBatch` creates the row and DETACHES the execution, because eight cases
 * at a 120 s ceiling each is up to sixteen minutes and no HTTP request should
 * hold that. `runBatch` does the same work and awaits it, which is what a test
 * — and the demo recorder — needs in order to assert on a finished batch
 * instead of racing it. Both go through the same private `execute`, so the
 * detached path is never a second implementation that can drift.
 */
export class EvalService {
  private repo: EvalRepository;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // =========================================================================
  // Cases
  // =========================================================================

  /**
   * Turn one DECIDED finding into an eval case (AC-15…AC-25).
   *
   * The decision is the direction: accepted → `must_find`, dismissed →
   * `must_not_flag`, neither → 422. A second case from the same finding is
   * allowed (AC-24) and the response names the ones that already exist (AC-25)
   * rather than blocking the click.
   */
  async createCaseFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<CreateEvalCaseFromFinding> {
    const found = await this.repo.findingWithPatch(workspaceId, findingId);
    if (!found) throw new NotFoundError('Finding not found');

    const expectation = expectationForFinding(found.finding);
    if (!expectation) {
      throw new ValidationError(
        'This finding has neither been accepted nor dismissed, so there is no expectation ' +
          'to record. Decide it first, then turn it into a case.',
      );
    }

    // AC-18 + AC-101: name the missing diff as the reason, in the body. A case
    // with an empty diff passes creation, grounds nothing, and pins `recall` at
    // zero forever while the dashboard looks full and green.
    if (!found.patch || found.patch.trim().length === 0) {
      throw new ValidationError(NO_DIFF_MESSAGE);
    }

    if (!found.agentId) {
      throw new ValidationError(
        'This finding came from a review with no agent attached, so the case would have no ' +
          'owner to run under.',
      );
    }

    const existing = await this.repo.casesForFinding(workspaceId, findingId);

    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: found.agentId,
      name: evalCaseName(found.finding),
      inputDiff: toFileDiff(found.finding.file, found.patch),
      expectedOutput: expectedOutputFor(expectation, found.finding),
      expectation,
      sourceFindingId: findingId,
      inputMeta: { seeded_from_finding: findingId },
    });

    return { case: toCaseDto(row), existing_cases: existing.map(toCaseDto) };
  }

  /** The owner's whole set, in one response (NFR-14 — never paginated). */
  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseRecord[]> {
    const rows = await this.repo.listCases(workspaceId, 'agent', agentId);
    return rows.map(toCaseDto);
  }

  /** Hand-written case creation — the case editor's "New eval case" entry point. */
  async createCase(workspaceId: string, input: EvalCaseUpsert): Promise<EvalCaseRecord> {
    this.rejectSkillOwner(input.owner_kind);
    const row = await this.repo.insertCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? [],
      notes: input.notes ?? null,
      expectation: input.expectation,
    });
    return toCaseDto(row);
  }

  async updateCase(
    workspaceId: string,
    id: string,
    input: EvalCaseUpsert,
  ): Promise<EvalCaseRecord> {
    this.rejectSkillOwner(input.owner_kind);
    const row = await this.repo.updateCase(workspaceId, id, {
      name: input.name,
      inputDiff: input.input_diff,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? [],
      notes: input.notes ?? null,
      expectation: input.expectation,
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return toCaseDto(row);
  }

  async deleteCase(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteCase(workspaceId, id);
    if (!ok) throw new NotFoundError('Eval case not found');
  }

  /**
   * AC-27. `owner_kind` already accepts `'skill'` in the contract and the column
   * — evals for skills are a named non-goal (UX-1), and a skill has no system
   * prompt to snapshot, so a batch over one could not exist. Rejected at the
   * service, not silently coerced.
   */
  private rejectSkillOwner(ownerKind: 'agent' | 'skill'): void {
    if (ownerKind === 'skill') {
      throw new ValidationError('Eval cases owned by a skill are not supported.');
    }
  }

  // =========================================================================
  // Batches
  // =========================================================================

  /**
   * Start a batch and return immediately with the `running` row (the route's
   * path). The execution continues in the background; failures are logged, not
   * thrown into a dead request.
   */
  async startBatch(workspaceId: string, agentId: string, logger?: PinoLike) {
    const prepared = await this.prepare(workspaceId, agentId);
    void this.execute(prepared, logger).catch((err: unknown) => {
      logger?.error({ err, batchId: prepared.batch.id }, 'eval batch failed');
    });
    return toBatchDto(prepared.batch);
  }

  /**
   * Start a batch and AWAIT it, returning the finished row. The deterministic
   * handle: tests and the demo recorder assert on a batch that has actually
   * ended rather than polling one that might not have.
   */
  async runBatch(workspaceId: string, agentId: string, logger?: PinoLike) {
    const prepared = await this.prepare(workspaceId, agentId);
    const finished = await this.execute(prepared, logger);
    return toBatchDto(finished);
  }

  /**
   * The three gates, then the snapshot.
   *
   * The snapshot (system prompt, agent version, provider, model) is taken HERE,
   * at start (AC-48, AC-49, AC-50) — an agent edited a minute into the batch
   * does not retroactively change what this batch ran against, which is the
   * entire basis on which two batches can be compared at all (NFR-6).
   */
  private async prepare(workspaceId: string, agentId: string) {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // A second batch while one is still running would produce two prompt
    // snapshots for one agent version and no way to say which run belonged to
    // which click. There is no queue (UX-5), so the honest answer is 409.
    const running = await this.repo.runningBatch(workspaceId, agentId);
    if (running) {
      throw new ConflictError('A batch for this agent is already running.', {
        batch_id: running.id,
      });
    }

    const cases = await this.repo.listCases(workspaceId, 'agent', agentId);
    if (cases.length === 0) {
      throw new ValidationError(
        'This agent has no eval cases, so there is nothing to run. Turn a decided finding ' +
          'into a case first.',
      );
    }

    const batch = await this.repo.insertBatch({
      workspaceId,
      agentId,
      agentVersion: agent.version,
      systemPromptSnapshot: agent.systemPrompt,
      provider: agent.provider,
      model: agent.model,
      casesTotal: cases.length,
    });

    return { workspaceId, agent, cases, batch };
  }

  /**
   * Run every case ONCE (AC-36), one at a time (AC-37), then aggregate.
   *
   * Sequential is not an oversight to be optimised later: it is the criterion.
   * `Promise.all` over eight cases would make eight concurrent billed calls and
   * make NFR-10's per-case ceiling meaningless.
   */
  private async execute(
    prepared: Awaited<ReturnType<EvalService['prepare']>>,
    logger?: PinoLike,
  ): Promise<EvalBatchRow> {
    const { workspaceId, agent, cases, batch } = prepared;
    const runLog = logger
      ? new RunLogger(this.container.runBus, [], logger, { batchId: batch.id })
      : undefined;

    const skills = await this.container.resolveAgentSkills(agent.id);
    const llm = await this.container.llm(agent.provider);

    /** Only cases that produced a COMPARABLE answer feed the aggregates (AC-42). */
    const completed: EvalCaseResult[] = [];
    const completedCosts: (number | null)[] = [];
    let errored = 0;
    let done = 0;

    for (const evalCase of cases) {
      const startedAt = Date.now();
      runLog?.tool(evalTraceLine(evalCase.name, agent.provider, agent.model));

      let outcome: ReviewOutcome | undefined;
      let failure: string | undefined;
      try {
        const diff = parseUnifiedDiff(evalCase.inputDiff ?? '');
        // AC-40: a stored diff that does not parse never produced a comparable
        // answer, which is `errored` and NOT `failed`.
        if (diff.files.length === 0) {
          throw new Error('The stored diff could not be parsed into any file.');
        }
        outcome = await this.reviewOneCase({
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          skills,
          diff,
          llm,
        });
      } catch (err) {
        // A violated invariant is not a failing case — let it out (see
        // `EvalInvariantError`), or a disarmed-scope bug becomes a grey row.
        if (err instanceof EvalInvariantError) throw err;
        failure = err instanceof Error ? err.message : String(err);
      }

      const durationMs = Date.now() - startedAt;

      if (!outcome) {
        // AC-38: the row EXISTS, `pass` is false and the metrics are empty; the
        // batch then continues with the next case (AC-39).
        errored++;
        await this.repo.insertRun({
          caseId: evalCase.id,
          batchId: batch.id,
          actualOutput: { error: failure ?? 'unknown error' },
          pass: false,
          status: 'errored',
          recall: null,
          precision: null,
          citationAccuracy: null,
          durationMs,
          costUsd: null,
        });
        runLog?.error(`${evalCase.name}: errored — ${failure}`);
        continue;
      }

      // Bound to a const before the transaction closure: `outcome` is a `let`
      // and narrowing a `let` across a callback boundary is exactly the kind of
      // inference that changes between TypeScript releases.
      const completedOutcome = outcome;
      const result: EvalCaseResult = {
        expectation: evalCase.expectation,
        expected: parseExpectedOutput(evalCase.expectedOutput),
        actual: completedOutcome.review.findings,
        // A COUNT, not the array — `dropped` is how many grounding threw away.
        dropped: completedOutcome.dropped.length,
      };
      const score = scoreEvalCase(result);
      completed.push(result);
      completedCosts.push(completedOutcome.costUsd);
      done++;

      // One case = one business operation: the run row and the progress counter
      // move together, so a reader never sees `3 of 8` beside two rows.
      await this.container.db.transaction(async (tx) => {
        await this.repo.insertRun(
          {
            caseId: evalCase.id,
            batchId: batch.id,
            actualOutput: completedOutcome.review,
            pass: score.pass,
            status: score.pass ? 'passed' : 'failed',
            recall: score.recall,
            precision: score.precision,
            citationAccuracy: score.citation_accuracy,
            durationMs,
            costUsd: completedOutcome.costUsd,
          },
          tx,
        );
        await this.repo.bumpBatchProgress(batch.id, done, tx);
      });
    }

    // AC-53 / AC-54: the aggregates are the SHARED scorer's, over completed
    // cases only, with zero model calls (AC-55) — `scoreEvalBatch` has no
    // provider parameter to make one with.
    const aggregate = scoreEvalBatch(completed);

    const finished = await this.repo.finishBatch(batch.id, {
      // AC-41 + AC-42 read as a pair: `partial` marks a batch whose aggregates
      // were computed over FEWER cases than its set, which is exactly the
      // errored ones. A case that ran and scored badly is a measurement, not a
      // gap — marking that partial would make every honest batch partial and
      // the flag would stop meaning anything.
      status: errored > 0 ? 'partial' : 'complete',
      casesCompleted: completed.length,
      recall: aggregate.recall,
      precision: aggregate.precision,
      citationAccuracy: aggregate.citation_accuracy,
      costUsd: sumCaseCosts(completedCosts),
      finishedAt: new Date(),
    });

    runLog?.result(
      `Eval batch finished: ${aggregate.cases_passed}/${cases.length} passed` +
        (errored > 0 ? `, ${errored} errored` : ''),
    );

    // The row was inserted moments ago in the same workspace; a miss here means
    // it was deleted mid-batch, and the pre-update row is the honest answer.
    return finished ?? (await this.repo.getBatch(workspaceId, batch.id)) ?? batch;
  }

  /**
   * One case, one model call, with the NFR-10 ceiling.
   *
   * The ceiling is a race AND a signal, not either alone: the signal is what a
   * well-behaved provider aborts on, and the race is what stops a provider that
   * ignores it from holding the remaining seven cases hostage. Exceeding it
   * throws, which the caller records as `errored`.
   */
  private async reviewOneCase(args: {
    systemPrompt: string;
    model: string;
    skills: string[];
    diff: ReturnType<typeof parseUnifiedDiff>;
    llm: Awaited<ReturnType<Container['llm']>>;
  }): Promise<ReviewOutcome> {
    const controller = new AbortController();
    const input = buildEvalReviewInput({ ...args, signal: controller.signal });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const ceiling = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Case exceeded the ${CASE_TIMEOUT_MS} ms ceiling.`));
      }, CASE_TIMEOUT_MS);
    });

    const review = reviewPullRequest(input);
    // The race's loser is still a live promise: without this, a rejection that
    // arrives after the ceiling won is an unhandled rejection that kills the
    // process. Registering the handler does not consume the rejection the race
    // is watching for.
    review.catch(() => undefined);

    try {
      return await Promise.race([review, ceiling]);
    } finally {
      clearTimeout(timer);
    }
  }

  // =========================================================================
  // Reads
  // =========================================================================

  async getBatch(workspaceId: string, id: string) {
    const row = await this.repo.getBatch(workspaceId, id);
    if (!row) throw new NotFoundError('Eval batch not found');
    return toBatchDto(row);
  }

  /**
   * An agent's batch history, newest first — the run history the compare flow
   * selects its two rows from.
   *
   * Without this route the compare flow is unreachable end to end: the dashboard
   * hands the client per-CASE run rows (no batch id), per-batch trend POINTS (no
   * ids) and a single `latest_batch`, so a table could be given at most one
   * selectable row and `GET /eval-batches/compare?a=&b=` could never be called
   * with two. The prompt snapshot exists precisely to make that comparison
   * meaningful, so the list is not a convenience read.
   *
   * Every status, including `running` — see `EvalRepository.listBatches` for why
   * that is a sibling read rather than a widening of `finishedBatches`.
   *
   * A 404 for an unknown agent, matching `dashboard` rather than `listCases`.
   * The two conventions genuinely differ in this module and the choice is
   * deliberate: `listCases` returns an empty set for a foreign owner because a
   * case set is a collection that can legitimately be empty, whereas this route
   * and `dashboard` are the two reads of the SAME screen — answering `[]` for an
   * agent that does not exist in this workspace would assert "this agent has no
   * batches", which is a different and misleading statement. Non-disclosure is
   * unaffected either way: the underlying query is workspace-scoped, so a
   * foreign agent's batches are never selectable.
   */
  async listBatches(workspaceId: string, agentId: string): Promise<EvalBatchRecord[]> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const rows = await this.repo.listBatches(workspaceId, agentId, BATCH_HISTORY_LIMIT);
    return rows.map(toBatchDto);
  }

  async runsForBatch(workspaceId: string, id: string): Promise<EvalRunRecord[]> {
    const batch = await this.repo.getBatch(workspaceId, id);
    if (!batch) throw new NotFoundError('Eval batch not found');
    const rows = await this.repo.runsForBatch(workspaceId, id);
    return rows.map((r) => toRunDto(r.run, r.caseName));
  }

  /**
   * Two batches side by side (NFR-6).
   *
   * `comparable` is the SERVER's call: a metric that moved between two
   * different models says nothing about the prompt, which is the only thing the
   * comparison is for. Whether the two batches belong to the same AGENT is
   * visible on both records (`agent_id`) and left to the caller — the client's
   * own criterion keeps the action unavailable in that case, so the server
   * answering the question twice would just be two places to change it.
   */
  async compare(workspaceId: string, aId: string, bId: string): Promise<EvalBatchCompare> {
    const [aRow, bRow] = await Promise.all([
      this.repo.getBatch(workspaceId, aId),
      this.repo.getBatch(workspaceId, bId),
    ]);
    if (!aRow || !bRow) throw new NotFoundError('Eval batch not found');

    const a = toBatchDto(aRow);
    const b = toBatchDto(bRow);

    return {
      a,
      b,
      deltas: {
        recall: metricDelta(a.recall, b.recall),
        precision: metricDelta(a.precision, b.precision),
        citation_accuracy: metricDelta(a.citation_accuracy, b.citation_accuracy),
        cost_usd: costDelta(a.cost_usd, b.cost_usd),
      },
      comparable: a.provider === b.provider && a.model === b.model,
      prompt_diff_available:
        a.system_prompt_snapshot !== null && b.system_prompt_snapshot !== null,
    };
  }

  /**
   * The agent's eval dashboard.
   *
   * `current` is the latest FINISHED batch, never one still running: a batch in
   * flight has no aggregates, so reading it as `current` would replace the last
   * real numbers with three dashes for as long as it runs.
   *
   * Zero model calls on this path — the aggregates are read back from the batch
   * row and the banner is a template (AC-55, AC-57).
   */
  async dashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [casesTotal, batches, recent, latest] = await Promise.all([
      this.repo.countCases(workspaceId, 'agent', agentId),
      this.repo.finishedBatches(workspaceId, agentId, TREND_LIMIT),
      this.repo.recentRuns(workspaceId, agentId, RECENT_RUNS_LIMIT),
      // Any status, including `running` — see `latest_batch` on the contract.
      this.repo.latestBatch(workspaceId, agentId),
    ]);

    const current = batches[0];
    const previous = batches[1];
    const passedByBatch = await this.repo.passedCountByBatch(
      workspaceId,
      batches.map((b) => b.id),
    );

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: casesTotal,
      current: {
        recall: current?.recall ?? null,
        precision: current?.precision ?? null,
        citation_accuracy: current?.citationAccuracy ?? null,
        traces_passed: current ? (passedByBatch.get(current.id) ?? 0) : 0,
        traces_total: current?.casesTotal ?? 0,
        cost_usd: current?.costUsd ?? null,
        partial: current?.status === 'partial',
      },
      // The lifecycle channel, beside `current`'s numbers channel. While a batch
      // runs these point at DIFFERENT rows on purpose: `current` keeps showing
      // the last finished batch's real scores, and this says a run is in flight
      // so the client can keep the run action disabled even in a tab that never
      // saw the 202. Collapsing the two loses one or the other.
      latest_batch: latest ? toBatchDto(latest) : null,
      // AC-73's absence: no previous batch is `null`, not three zeroes. A delta
      // that is genuinely zero is a number and is reported as one.
      delta: previous
        ? {
            recall: metricDelta(previous.recall, current?.recall ?? null),
            precision: metricDelta(previous.precision, current?.precision ?? null),
            citation_accuracy: metricDelta(
              previous.citationAccuracy,
              current?.citationAccuracy ?? null,
            ),
          }
        : null,
      // Chronological, oldest first — a trend read left to right.
      trend: [...batches]
        .reverse()
        .map((b) => toTrendPoint(b, passedByBatch.get(b.id) ?? 0)),
      recent_runs: recent.map((r) => toRunDto(r.run, r.caseName)),
      alert: regressionAlert(
        {
          recall: current?.recall ?? null,
          precision: current?.precision ?? null,
        },
        previous ? { recall: previous.recall, precision: previous.precision } : null,
        REGRESSION_THRESHOLD,
      ),
    };
  }
}
