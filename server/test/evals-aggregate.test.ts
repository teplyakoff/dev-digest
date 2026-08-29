import { describe, it, expect } from 'vitest';
import {
  costDelta,
  metricDelta,
  sumCaseCosts,
  toBatchDto,
  toRunDto,
  toTrendPoint,
  type EvalBatchRow,
  type EvalRunRow,
} from '../src/modules/evals/helpers.js';

/**
 * L06 / SPEC-08 — the batch's money and its derived flags (AC-41, AC-43, AC-51,
 * AC-52), hermetically.
 *
 * The METRICS are not re-asserted here: they come from `scoreEvalBatch` in
 * `reviewer-core` and are pinned in that package's own suite. What lives on this
 * side of the boundary is cost (which the engine has no opinion about), the
 * partial flag (derived from the status, not stored twice) and the row → DTO
 * mapping the client reads.
 *
 * The single defect this file exists to catch is `?? 0` on an unknown. `null`
 * means UNKNOWN and `0` means free; collapsing them puts a wrong spend figure
 * on a screen with nothing to say it is wrong.
 *
 * NO DOCKER.
 */

const batchRow = (over: Partial<EvalBatchRow> = {}): EvalBatchRow =>
  ({
    id: 'batch-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    agentVersion: 3,
    systemPromptSnapshot: 'You are the Security Reviewer.',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    status: 'complete',
    casesTotal: 8,
    casesCompleted: 8,
    recall: 0.75,
    precision: 0.6,
    citationAccuracy: 0.9,
    costUsd: 0.004,
    startedAt: new Date('2026-08-27T10:00:00.000Z'),
    finishedAt: new Date('2026-08-27T10:04:00.000Z'),
    ...over,
  }) as EvalBatchRow;

describe('sumCaseCosts — unknown is not zero (AC-51, AC-52)', () => {
  it('sums the completed cases when every cost is known (AC-51)', () => {
    expect(sumCaseCosts([0.001, 0.002, 0.0005])).toBeCloseTo(0.0035, 10);
  });

  it('returns null — not 0 — when ANY completed case’s cost is unknown (AC-52)', () => {
    const total = sumCaseCosts([0.001, null, 0.002]);

    expect(total).toBeNull();
    // Named by hand, because `0` is what a `?? 0` produces and it type-checks,
    // renders, and reads as "this batch was free" beside two billed calls.
    expect(total).not.toBe(0);
  });

  it('treats an absent cost the same as an explicit null', () => {
    // `costUsd` arrives from the engine as `number | null`, and a provider that
    // simply omits it must not be read as free either.
    expect(sumCaseCosts([0.001, undefined])).toBeNull();
  });

  it('reports a genuinely free batch as 0, which is a different fact', () => {
    expect(sumCaseCosts([0, 0])).toBe(0);
    expect(sumCaseCosts([])).toBe(0);
  });
});

describe('metricDelta / costDelta', () => {
  it('computes b − a', () => {
    expect(metricDelta(0.5, 0.75)).toBeCloseTo(0.25, 10);
    expect(metricDelta(0.75, 0.5)).toBeCloseTo(-0.25, 10);
  });

  it('returns null when either side is unknown — never a delta against an unknown', () => {
    expect(metricDelta(null, 0.75)).toBeNull();
    expect(metricDelta(0.75, null)).toBeNull();
  });

  it('reports a genuinely unchanged metric as 0, not as null', () => {
    // The distinction the client's "no delta badge" state depends on: `null`
    // means there is nothing to compare, `0` means it did not move.
    expect(metricDelta(0.6, 0.6)).toBe(0);
  });

  it('rounds the metric delta but NOT the cost delta', () => {
    // Six decimals on a 0…1 metric is a ten-thousandth of a percentage point;
    // the same rounding on money would show a real difference between two
    // ~$0.0003 batches as zero.
    expect(metricDelta(0.6, 0.59)).toBe(-0.01);
    expect(costDelta(0.0003, 0.00042)).toBeCloseTo(0.00012, 12);
    expect(costDelta(null, 0.0004)).toBeNull();
  });
});

describe('toBatchDto — the partial flag rides on every aggregate response (AC-41, AC-43)', () => {
  it('derives partial from the status rather than storing the fact twice', () => {
    expect(toBatchDto(batchRow({ status: 'partial' })).partial).toBe(true);
    expect(toBatchDto(batchRow({ status: 'complete' })).partial).toBe(false);
    expect(toBatchDto(batchRow({ status: 'running' })).partial).toBe(false);
  });

  it('carries unknown aggregates through as null instead of inventing zeroes', () => {
    const dto = toBatchDto(
      batchRow({ recall: null, precision: null, citationAccuracy: null, costUsd: null }),
    );

    expect(dto.recall).toBeNull();
    expect(dto.precision).toBeNull();
    expect(dto.citation_accuracy).toBeNull();
    expect(dto.cost_usd).toBeNull();
  });

  it('carries the snapshot fields the whole comparison rests on (AC-48, AC-49, AC-50)', () => {
    const dto = toBatchDto(batchRow());

    expect(dto.system_prompt_snapshot).toBe('You are the Security Reviewer.');
    expect(dto.agent_version).toBe(3);
    expect(dto.provider).toBe('openrouter');
    expect(dto.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('serialises timestamps as ISO strings, and an unfinished batch as null', () => {
    expect(toBatchDto(batchRow()).finished_at).toBe('2026-08-27T10:04:00.000Z');
    expect(toBatchDto(batchRow({ finishedAt: null })).finished_at).toBeNull();
  });
});

describe('toTrendPoint', () => {
  it('divides passed cases by the batch’s TOTAL, not by the completed ones', () => {
    // A partial batch that passed 2 of its 3 completed cases out of 8 has a
    // pass rate of 2/8. Dividing by the completed count would make a batch look
    // better precisely because more of it failed to run.
    const point = toTrendPoint(batchRow({ casesTotal: 8, casesCompleted: 3 }), 2);
    expect(point.pass_rate).toBeCloseTo(0.25, 10);
  });

  it('passes unknown metrics through as null', () => {
    const point = toTrendPoint(batchRow({ recall: null, costUsd: null }), 0);
    expect(point.recall).toBeNull();
    expect(point.cost_usd).toBeNull();
  });

  it('dates the point by when the batch FINISHED, falling back to its start', () => {
    expect(toTrendPoint(batchRow(), 8).ran_at).toBe('2026-08-27T10:04:00.000Z');
    expect(toTrendPoint(batchRow({ finishedAt: null }), 8).ran_at).toBe(
      '2026-08-27T10:00:00.000Z',
    );
  });
});

describe('toRunDto', () => {
  const runRow = (over: Partial<EvalRunRow> = {}): EvalRunRow =>
    ({
      id: 'run-1',
      caseId: 'case-1',
      batchId: 'batch-1',
      ranAt: new Date('2026-08-27T10:01:00.000Z'),
      actualOutput: { findings: [] },
      pass: false,
      status: 'errored',
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 1200,
      costUsd: null,
      ...over,
    }) as EvalRunRow;

  it('keeps errored distinct from failed on the row the client renders (AC-40)', () => {
    // `pass: false` is true of both. Only `status` tells "the case never
    // produced a comparable answer" apart from "it produced a wrong one", and
    // the client's own criterion renders them differently.
    expect(toRunDto(runRow({ status: 'errored' })).status).toBe('errored');
    expect(toRunDto(runRow({ status: 'failed', pass: false })).status).toBe('failed');
  });

  it('reports empty metrics as null and carries the case name when joined', () => {
    const dto = toRunDto(runRow(), 'Hardcoded key — src/config.ts:11-11');
    expect(dto.recall).toBeNull();
    expect(dto.case_name).toBe('Hardcoded key — src/config.ts:11-11');
    expect(toRunDto(runRow()).case_name).toBeNull();
  });
});
