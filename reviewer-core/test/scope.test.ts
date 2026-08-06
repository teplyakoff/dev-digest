/**
 * The deterministic scope gate's four bounds, one test each.
 *
 * Every one of them is a safety bound rather than a nicety, so each test is
 * written as "the gate must NOT be able to do X" — the failure mode this feature
 * has is a suppressed real defect, not a missing filter.
 */
import { describe, it, expect } from 'vitest';
import { applyScopeFilter, type ScopedFinding } from '../src/review/scope.js';

function finding(over: Partial<ScopedFinding> = {}): ScopedFinding {
  return {
    file: 'src/a.ts',
    start_line: 1,
    end_line: 2,
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    rationale: 'because',
    confidence: 0.8,
    kind: 'finding',
    ...over,
  } as ScopedFinding;
}

describe('applyScopeFilter', () => {
  it('bound 1 — drops nothing at all when it is not armed', () => {
    const findings = [finding({ scope: 'out_of_scope' }), finding({ scope: 'out_of_scope' })];
    const res = applyScopeFilter(findings, { enabled: false });
    expect(res.kept).toEqual(findings);
    expect(res.dropped).toEqual([]);
  });

  it('bound 2 — never drops a secret_leak or a lethal_trifecta, however tagged', () => {
    // Both are full-file findings by construction, so they are "out of scope" of
    // essentially every PR. A filter that can suppress a leaked secret is a
    // security regression wearing noise-reduction's clothes.
    const secret = finding({ kind: 'secret_leak', scope: 'out_of_scope', title: 'AWS key' });
    const trifecta = finding({ kind: 'lethal_trifecta', scope: 'out_of_scope', title: 'trifecta' });
    const plain = finding({ scope: 'out_of_scope', title: 'nit' });
    const res = applyScopeFilter([secret, trifecta, plain], { enabled: true });
    expect(res.kept).toContain(secret);
    expect(res.kept).toContain(trifecta);
    expect(res.dropped.map((d) => d.finding.title)).toEqual(['nit']);
  });

  it('bound 3 — keeps exactly one out-of-scope survivor, and only when CRITICAL', () => {
    const crit = finding({ severity: 'CRITICAL', scope: 'out_of_scope', title: 'sqli', confidence: 0.6 });
    const critLower = finding({ severity: 'CRITICAL', scope: 'out_of_scope', title: 'other', confidence: 0.9 });
    const warn = finding({ severity: 'WARNING', scope: 'out_of_scope', title: 'warn' });
    const inScope = finding({ scope: 'in_scope', title: 'kept' });

    const res = applyScopeFilter([crit, critLower, warn, inScope], { enabled: true });
    // Same severity → higher confidence wins the single slot.
    expect(res.kept.map((f) => f.title)).toEqual(['other', 'kept']);
    expect(res.dropped.map((d) => d.finding.title)).toEqual(['sqli', 'warn']);

    // With nothing critical out of scope, nothing survives the filter.
    const noCrit = applyScopeFilter([warn, inScope], { enabled: true });
    expect(noCrit.kept.map((f) => f.title)).toEqual(['kept']);
  });

  it('bound 4 — every drop is reported with a reason, so the caller can never go silent', () => {
    const res = applyScopeFilter([finding({ scope: 'out_of_scope', title: 'x' })], { enabled: true });
    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0]!.reason).toMatch(/scope/i);
  });

  it('leaves untagged findings alone — an absent tag is not an out-of-scope tag', () => {
    // `scope` is `.nullish()` on the engine-local schema, so a model that
    // ignored the instruction (or an older fixture) yields undefined. That must
    // read as "unknown", never as permission to drop.
    const findings = [finding({ scope: undefined }), finding({ scope: null })];
    expect(applyScopeFilter(findings, { enabled: true }).kept).toEqual(findings);
  });
});
