import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  PrHistory,
  SmartDiff,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrMeta,
  PrDetail,
  ContextDoc,
  ContextDocBody,
  ContextStoreStatus,
  ImportCandidates,
  AttachmentSet,
  AttachedDoc,
  CreateContextDoc,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */
describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    // `intent` was renamed to `summary` in L03 (migration 0015), while
    // `pr_intent` still had zero rows and `upsertIntent` had zero callers — it
    // was the last moment `PrBrief.intent.intent` could be fixed for free.
    expect(() =>
      Intent.parse({ summary: 'x', in_scope: ['a'], out_of_scope: ['b'] }),
    ).not.toThrow();
    expect(() => Intent.parse({ intent: 'x', in_scope: [], out_of_scope: [] })).toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const file = {
      path: 'a.ts',
      additions: 84,
      deletions: 0,
      // `finding_lines` is derived: findings.map(f => f.line).
      finding_lines: [28, 52],
      findings: [
        { id: 'f1', line: 28, severity: 'CRITICAL', title: 'Hardcoded Stripe secret key' },
        { id: 'f2', line: 52, severity: 'WARNING', title: 'Unbounded query on the hot path' },
      ],
      is_large: false,
    };
    const d = SmartDiff.parse({
      groups: [{ role: 'core', files: [file] }],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
    expect(d.groups[0]!.files[0]!.findings.map((f) => f.line)).toEqual(
      d.groups[0]!.files[0]!.finding_lines,
    );
    // `findings` and `is_large` are REQUIRED. Making either optional would admit
    // a payload carrying only the derived `finding_lines`, which is the drift
    // the single-source join exists to prevent — pin it here, where it is cheap.
    const { findings: _f, is_large: _l, ...legacy } = file;
    expect(() =>
      SmartDiff.parse({
        groups: [{ role: 'core', files: [legacy] }],
        split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
      }),
    ).toThrow();
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: {
        duration_ms: 8200,
        tokens_in: 14820,
        tokens_out: 1240,
        cost_usd: 0.06,
        findings: 3,
        grounding: '3/3 passed',
      },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });

  it('PrMeta severity counters (list endpoint)', () => {
    const base = {
      number: 482,
      title: 't',
      author: 'a',
      branch: 'b',
      base: 'main',
      head_sha: 'sha',
      additions: 1,
      deletions: 0,
      files_count: 1,
      status: 'open',
    };
    const pr = PrMeta.parse({
      ...base,
      findings_by_severity: { CRITICAL: 1, WARNING: 0, SUGGESTION: 1 },
      latest_findings: [
        {
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          confidence: 0.98,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
        },
      ],
    });
    expect(pr.findings_by_severity?.WARNING).toBe(0);
    expect(pr.latest_findings).toHaveLength(1);
    // Legacy payloads without the fields still parse (nullish back-compat).
    expect(() => PrMeta.parse(base)).not.toThrow();
  });
  it('project-context store (SPEC-06)', () => {
    const doc = ContextDoc.parse({
      id: 'd1',
      name: 'ARCHITECTURE.md',
      bytes: 2048,
      tokens: 512,
      agents: 2,
      updated_at: '2026-08-22T10:00:00.000Z',
    });
    expect(doc.name).toBe('ARCHITECTURE.md');

    // The body-carrying read extends the metadata rather than replacing it, so
    // a list row and an editor load are the same shape plus one field.
    expect(ContextDocBody.parse({ ...doc, body: '# Architecture\n' }).body).toContain('#');

    expect(ContextStoreStatus.parse({ docs: 3, total_bytes: 9001 }).docs).toBe(3);

    // A skipped candidate carries its reason; an importable one does not.
    const listed = ImportCandidates.parse({
      candidates: [
        { path: 'docs/PRD.md', bytes: 900, status: 'ok' },
        { path: 'docs/huge.md', bytes: 999_999, status: 'skipped', reason: 'too_large' },
      ],
      truncated: true,
    });
    // A discriminated union, so the two arms are different shapes rather than
    // one shape with an optional field. `reason` is reachable only after
    // narrowing, which is the type-level half of the same guarantee.
    const [ok, skipped] = listed.candidates;
    expect(ok!.status).toBe('ok');
    expect(skipped!.status === 'skipped' && skipped.reason).toBe('too_large');
    expect(listed.truncated).toBe(true);

    // An unknown reason is still rejected …
    expect(() =>
      ImportCandidates.parse({
        candidates: [{ path: 'a.md', bytes: 1, status: 'skipped', reason: 'because' }],
        truncated: false,
      }),
    ).toThrow();
    // … and so is `skipped` with NO reason, which the previous shape allowed.
    // That state rendered as the literal string `picker.skipped.undefined` in
    // the import picker, because the client indexes a translation key by it.
    expect(() =>
      ImportCandidates.parse({
        candidates: [{ path: 'a.md', bytes: 1, status: 'skipped' }],
        truncated: false,
      }),
    ).toThrow();
    // An `ok` arm carrying a reason does not throw — Zod strips unknown keys
    // rather than rejecting them — but the reason does not SURVIVE the parse,
    // which is the guarantee the picker actually depends on.
    const contradiction = ImportCandidates.parse({
      candidates: [{ path: 'a.md', bytes: 1, status: 'ok', reason: 'too_large' }],
      truncated: false,
    });
    expect(contradiction.candidates[0]).toEqual({ path: 'a.md', bytes: 1, status: 'ok' });

    // Attachment is a whole set, never a delta — an empty array detaches all.
    expect(AttachmentSet.parse({ doc_ids: [] }).doc_ids).toEqual([]);
    expect(AttachedDoc.parse({ ...doc, missing: true }).missing).toBe(true);

    // Import and text are the two ways in; upload rides on `text` (R-1).
    expect(CreateContextDoc.parse({ kind: 'import', path: 'docs/PRD.md' }).kind).toBe('import');
    expect(CreateContextDoc.parse({ kind: 'text', name: 'notes.md', body: '' }).kind).toBe('text');
    expect(() => CreateContextDoc.parse({ kind: 'upload', name: 'n.md', body: '' })).toThrow();
  });
});
