import { describe, it, expect } from 'vitest';
import { countBySeverity } from '../src/modules/pulls/severity.js';

describe('countBySeverity', () => {
  it('zero-seeds every severity for an empty list (reviewed-clean ≠ unreviewed)', () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it('counts mixed severities', () => {
    const rows = [
      { severity: 'CRITICAL' },
      { severity: 'SUGGESTION' },
      { severity: 'CRITICAL' },
      { severity: 'WARNING' },
    ];
    expect(countBySeverity(rows)).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('ignores unknown severity strings instead of inventing keys', () => {
    const rows = [{ severity: 'INFO' }, { severity: 'critical' }, { severity: 'WARNING' }];
    expect(countBySeverity(rows)).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });
});
