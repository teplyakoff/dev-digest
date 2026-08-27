import { describe, it, expect } from 'vitest';
import { regressionAlert } from '../src/modules/evals/helpers.js';
import { REGRESSION_THRESHOLD } from '../src/modules/evals/constants.js';

/**
 * L06 / SPEC-08 — the regression banner (AC-56…AC-59), hermetically.
 *
 * AC-57 says the banner is produced with zero model calls, and here that is
 * STRUCTURAL rather than asserted: `regressionAlert` has no provider parameter,
 * so there is nothing in scope to call. The runtime half — that the dashboard
 * request that produces the banner resolves no provider — is
 * `evals-compare.it.test.ts`, where a provider stub that throws on every method
 * is injected and the request still answers.
 *
 * The threshold is imported, never re-typed: a test that hard-codes 0.01 keeps
 * passing after somebody changes the constant, and then pins nothing.
 *
 * NO DOCKER.
 */

const m = (recall: number | null, precision: number | null) => ({ recall, precision });

describe('regressionAlert — when it fires (AC-56)', () => {
  it('fires on a fall of exactly one percentage point', () => {
    // The boundary is inclusive: "щонайменше на один відсотковий пункт".
    const text = regressionAlert(m(0.59, 0.6), m(0.6, 0.6), REGRESSION_THRESHOLD);

    expect(text).not.toBe('');
    expect(text).toContain('recall');
    expect(text).not.toContain('precision');
  });

  it('stays silent on a fall of nine tenths of a point', () => {
    // `0.6 - 0.591` is 0.008999999999999952 in IEEE 754 and `0.6 - 0.59` is
    // 0.010000000000000009. Without the rounding inside the helper this pair of
    // tests is decided by float noise rather than by the rule, and the failure
    // mode is a banner that fires or not depending on which decimals a batch
    // happened to land on.
    expect(regressionAlert(m(0.591, 0.6), m(0.6, 0.6), REGRESSION_THRESHOLD)).toBe('');
  });

  it('fires on precision alone, and names only the metric that moved', () => {
    const text = regressionAlert(m(0.6, 0.4), m(0.6, 0.6), REGRESSION_THRESHOLD);

    expect(text).toContain('precision');
    expect(text).not.toContain('recall');
  });

  it('names BOTH metrics when both fell', () => {
    const text = regressionAlert(m(0.4, 0.3), m(0.6, 0.6), REGRESSION_THRESHOLD);

    expect(text).toContain('recall');
    expect(text).toContain('precision');
  });

  it('stays silent when a metric IMPROVED', () => {
    // A one-sided rule: this is a regression banner, not a change log.
    expect(regressionAlert(m(0.9, 0.9), m(0.6, 0.6), REGRESSION_THRESHOLD)).toBe('');
  });

  it('stays silent when nothing moved at all', () => {
    expect(regressionAlert(m(0.6, 0.6), m(0.6, 0.6), REGRESSION_THRESHOLD)).toBe('');
  });

  it('reports the two values and the size of the drop, not just that one happened', () => {
    // A banner that says "recall regressed" and nothing else sends the reader
    // back to the dashboard to find out by how much.
    const text = regressionAlert(m(0.5, 0.6), m(0.6, 0.6), REGRESSION_THRESHOLD);

    expect(text).toContain('60.0%');
    expect(text).toContain('50.0%');
    expect(text).toContain('10.0');
  });
});

describe('regressionAlert — when it must say nothing (AC-58, AC-59)', () => {
  it('returns an EMPTY string when there is no previous batch (AC-58)', () => {
    const text = regressionAlert(m(0.2, 0.2), null, REGRESSION_THRESHOLD);

    expect(text).toBe('');
    // A first batch with terrible numbers is not a regression — there is
    // nothing it regressed from. `null` here must not be read as `0`, which
    // would make every first batch look like a 20-point collapse.
    expect(text).not.toContain('recall');
  });

  it('does not mention a metric that is unknown in the CURRENT batch (AC-59)', () => {
    const text = regressionAlert(m(null, 0.3), m(0.6, 0.6), REGRESSION_THRESHOLD);

    expect(text).not.toContain('recall');
    expect(text).toContain('precision');
  });

  it('does not mention a metric that is unknown in the PREVIOUS batch (AC-59)', () => {
    const text = regressionAlert(m(0.3, 0.3), m(null, 0.6), REGRESSION_THRESHOLD);

    expect(text).not.toContain('recall');
    expect(text).toContain('precision');
  });

  it('returns an empty banner when BOTH metrics are unknown on one side', () => {
    // Not "recall fell from unknown to 30%" and not a 0-based drop: a
    // comparison against an unknown is not a comparison.
    expect(regressionAlert(m(0.3, 0.3), m(null, null), REGRESSION_THRESHOLD)).toBe('');
  });
});

describe('the threshold constant', () => {
  it('is a FRACTION on the 0…1 scale, not a percentage', () => {
    // Every metric in this system is 0…1. Writing `1` here — the literal
    // reading of "one percentage point" — silences the banner permanently and
    // nothing else changes.
    expect(REGRESSION_THRESHOLD).toBe(0.01);
  });
});
