# Frontend Architecture — Examples

Good/bad placement for each rule in [SKILL.md](SKILL.md).

---

## Group by Feature, Not by File Type

```
# BAD: screams "React app" — says nothing about the product.
# Every feature is scattered across four folders; deleting one is archaeology.
src/
├── components/      # PRRow, AgentCard, FindingsPanel, Button, Modal, Header…
├── hooks/           # useReviewRun, useRepoSearch, useAgentDraft, useDebounce…
├── contexts/        # repo-context, theme-context, toast-context
├── services/        # reviews.ts, agents.ts, repos.ts
└── utils/           # format.ts, helpers.ts, misc.ts
```

```
# GOOD: screams "PR review tool". Each feature is one folder and is deletable.
src/
├── features/
│   ├── reviews/
│   │   ├── components/ReviewSummary/
│   │   ├── hooks.ts
│   │   ├── queries.ts
│   │   └── helpers.ts
│   ├── repos/
│   └── agents/
├── components/      # only what 2+ features render
├── lib/             # only what 2+ features call
└── config/
```

> Generic pattern. **DevDigest does not use `src/features/`** — its router already supplies the
> feature tree, so the equivalent is `src/app/<route>/_components/<Name>/`. See
> [SKILL.md](SKILL.md) §3 and §14.

---

## The Promotion Ladder

```
# Step 1 — one consumer. It stays local. No shared folder yet.
src/app/repos/[repoId]/pulls/[number]/_components/RunCostBadge/
├── RunCostBadge.tsx
├── RunCostBadge.test.tsx
└── helpers.ts             # formatCost() — used only here

# Step 2 — the PR *list* now needs the same badge. NOW it moves.
# Same files, moved — promotion does not add files. A styles.ts appears only
# if the move actually produced shared class strings.
src/components/run-cost-badge/
├── RunCostBadge.tsx
├── RunCostBadge.test.tsx
└── helpers.ts
```

```
# BAD: promoting on the first consumer, "because it'll be reused later".
# It never was. Now it's a shared module nobody dares delete.
src/components/formatters/           # 1 consumer
src/lib/generic-list-helpers.ts      # 1 consumer
```

```ts
// BAD: promotion by copy — the two now drift, and no compiler will tell you.
// _components/PRRow/helpers.ts         → relativeTime()
// _components/RunHistory/helpers.ts    → relativeTime()   ← copy, already different

// GOOD: promotion by move — one definition deleted, one moved, both import it.
// src/lib/relative-time.ts
export function relativeTime(iso: string): string { /* … */ }
```

> Note the two outcomes for the same shape of question: `formatCost` **stayed** in
> `run-cost-badge/helpers.ts` because it had one consumer; `relativeTime` **moved** to `src/lib/`
> because it had two. The consumer count decides it — nothing else.

---

## Name for What It Provides

```
# BAD: named for the category. No criterion for what may enter,
# so everything eventually does.
src/utils/utils.ts
src/utils/helpers.ts
src/utils/misc.ts
src/utils/index.ts
```

```
# GOOD: named for what it provides. Obvious where a new function goes,
# and obvious when a file has stopped being about one thing.
src/lib/relative-time.ts
src/lib/github-urls.ts
src/lib/model-label.ts
```

> This rule governs files in shared folders. A colocated `helpers.ts` inside a component folder
> is exempt: its scope is already stated by the folder it sits in.

---

## Business Logic: Pure Function vs Hook vs Service

```tsx
// BAD: all three layers inside the component body.
function FindingsPanel({ runId }: Props) {
  const [findings, setFindings] = useState<Finding[]>([]);

  useEffect(() => {
    fetch(`/api/runs/${runId}/findings`)      // ← service layer
      .then(r => r.json())
      .then(setFindings);
  }, [runId]);

  const critical = findings.filter(f => f.severity === 'CRITICAL').length;  // ← pure logic
  return <span>{critical}</span>;
}
```

```ts
// GOOD — helpers.ts: pure, testable without React, no `use` prefix.
export function countBySeverity(findings: Finding[], severity: Severity): number {
  return findings.filter(f => f.severity === severity).length;
}

// GOOD — lib/api.ts: transport only.
export function fetchFindings(runId: string): Promise<Finding[]> { /* … */ }

// GOOD — lib/hooks/reviews.ts: orchestration. Key and query fn stay module-private.
const findingsKey = (runId: string) => ['runs', runId, 'findings'] as const;

export function useFindings(runId: string) {
  return useQuery({ queryKey: findingsKey(runId), queryFn: () => fetchFindings(runId) });
}
```

```tsx
// GOOD — the component: props in, hook call, JSX out.
function FindingsPanel({ runId }: Props) {
  const { data: findings = [] } = useFindings(runId);
  return <span>{countBySeverity(findings, 'CRITICAL')}</span>;
}
```

---

## A Hook That Isn't a Hook

```ts
// BAD: calls no Hooks, so the `use` prefix is a false claim —
// and it can't be called inside a condition.
function useSortedFindings(findings: Finding[]) {
  return [...findings].sort((a, b) => a.line - b.line);
}

// BAD: named for the mechanism, not the intent.
function useMount(fn: () => void) { useEffect(fn, []); }
```

```ts
// GOOD: a plain function — callable anywhere, including in a branch.
export function getSortedFindings(findings: Finding[]) {
  return [...findings].sort((a, b) => a.line - b.line);
}

// GOOD: named for a concrete use case.
export function useReviewRun(runId: string) { /* … */ }
```

---

## Query Keys: Owned by One Query, Never Registered Globally

```ts
// BAD: src/utils/queryKeys.ts — every feature imports it,
// so every feature is coupled to every other feature's cache shape.
export const queryKeys = {
  reviews: { all: ['reviews'], detail: (id: string) => ['reviews', id] },
  agents:  { all: ['agents'],  detail: (id: string) => ['agents', id] },
  repos:   { all: ['repos'] },
};
```

```ts
// GOOD: src/lib/hooks/reviews.ts — key lives with the query that owns it.
// Not exported: callers get the hook, never the key's shape.
const reviewsKey = {
  all: ['reviews'] as const,
  detail: (id: string) => ['reviews', id] as const,
};

export function useReview(id: string) {
  return useQuery({ queryKey: reviewsKey.detail(id), queryFn: () => fetchReview(id) });
}
```

---

## Constants

```tsx
// BAD: inline object in JSX — new reference every render, breaks memo on the child.
<SeverityFilter options={[{ id: 'critical' }, { id: 'warning' }]} />

// BAD: a global constants file every feature imports.
// src/constants.ts → PAGE_SIZE, SEVERITIES, API_TIMEOUT, THEME_KEYS, …
```

```tsx
// GOOD: one literal, one consumer → module level in the component's own file.
// A constants.ts holding this single line would be a file for nothing.
// FindingsPanel/FindingsPanel.tsx
const SEVERITY_OPTIONS = [{ id: 'critical' }, { id: 'warning' }] as const;

export function FindingsPanel({ runId }: Props) {
  return <Select options={SEVERITY_OPTIONS} />;
}
```

```ts
// GOOD: constants.ts once a second file in the same folder needs them —
// here FindingsPanel.tsx, helpers.ts and FindingsPanel.test.tsx all do.
// FindingsPanel/constants.ts
export const SEVERITY_OPTIONS = [{ id: 'critical' }, { id: 'warning' }] as const;
export const SEVERITY_ORDER = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;
export const DEFAULT_PAGE_SIZE = 25;
```

```ts
// GOOD: env read once, in one config module — not scattered across components.
export const config = {
  apiBase: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001',
} as const;
```

```tsx
// FINE: a literal used once, next to its meaning. Not every number needs a name.
<Spinner size={16} />
```

---

## Types

```ts
// BAD: a hand-written duplicate of a schema. Drifts silently —
// the compiler cannot tell you these two disagree.
// src/types/finding.ts
export interface Finding {
  id: string;
  severity: 'CRITICAL' | 'WARNING';   // schema added 'SUGGESTION' last week
  line: number;
}
```

```ts
// GOOD: import the type the contract already exports, from the specific module.
// Not '@/vendor/shared/contracts' — a directory import is a barrel (§12), and here
// it drags the whole contract index into the bundle.
import type { Finding, Severity } from '@/vendor/shared/contracts/findings';
```

```ts
// GOOD: extending or re-inferring happens at the use site — not in a central
// types module, and never inside src/vendor/** (it gets overwritten on re-vendor).
// These contracts export the schema and the type under the SAME name, so
// `Finding` is the value here and the type above; `typeof` selects the value.
import type { z } from 'zod';
import { Finding } from '@/vendor/shared/contracts/findings';

type FindingRow = z.infer<typeof Finding> & { expanded: boolean };
```

```ts
// GOOD: props type lives with its component, not in a shared types module.
// RunCostBadge/RunCostBadge.tsx
interface RunCostBadgeProps {
  cents: number;
  compact?: boolean;
}
```

---

## Splitting Components

```tsx
// BAD: split to hit a line count. One consumer, no state, no test of its own —
// pure indirection. Now you read two files to understand one thing.
function FindingsPanelHeader({ title }: { title: string }) {
  return <h2 className="text-lg font-semibold">{title}</h2>;
}
```

```tsx
// GOOD: split because the part owns state, and its re-renders are its own.
function FindingsPanel({ runId }: Props) {
  const { data: findings = [] } = useFindings(runId);
  return (
    <section>
      <h2 className="text-lg font-semibold">Findings</h2>
      <FindingsFilter findings={findings} />   {/* owns filter state */}
    </section>
  );
}
```

---

## Composition Beats Prop Drilling

```tsx
// BAD: `user` threaded through two components that never use it.
<Layout user={user}>
  <Sidebar user={user}>
    <UserMenu user={user} />
  </Sidebar>
</Layout>
```

```tsx
// GOOD: pass the rendered element. Layout and Sidebar never see `user` —
// no Context needed, and nothing re-renders on a change they don't care about.
<Layout>
  <Sidebar menu={<UserMenu user={user} />} />
</Layout>
```

---

## Server/Client Boundary

```tsx
// BAD: 'use client' on the container. Everything it imports —
// the whole subtree — joins the client bundle and hydrates.
'use client';

import { HeavyMarkdownRenderer } from './HeavyMarkdownRenderer';

export function PrDetail({ pr }: Props) {
  const [tab, setTab] = useState('overview');
  return (
    <div>
      <button onClick={() => setTab('diff')}>Diff</button>
      <HeavyMarkdownRenderer source={pr.body} />   {/* dragged client-side */}
    </div>
  );
}
```

```tsx
// GOOD: the client component is a leaf and takes rendered output as children.
// HeavyMarkdownRenderer stays on the server.
export function PrDetail({ pr }: Props) {          // server component
  return (
    <TabShell diff={<HeavyMarkdownRenderer source={pr.body} />}>
      <Overview pr={pr} />
    </TabShell>
  );
}

// TabShell.tsx
'use client';
export function TabShell({ children, diff }: Props) {
  const [tab, setTab] = useState('overview');
  return <div>{tab === 'diff' ? diff : children}</div>;
}
```

---

## Import Boundaries

```ts
// BAD: cross-feature import. `reviews` can no longer be deleted or moved
// without breaking `agents`.
// src/features/agents/components/AgentCard.tsx
import { formatVerdict } from '@/features/reviews/helpers';
```

```ts
// GOOD: it's needed by two features, so it moved to shared.
import { formatVerdict } from '@/lib/format-verdict';
```

```js
// GOOD: enforce it mechanically — a lint error at write time, not a review comment.
// eslint.config.mjs  (generic features/ layout)
'import/no-restricted-paths': ['error', {
  zones: [
    { target: './src/features/agents',  from: './src/features', except: ['./agents'] },
    { target: './src/features/reviews', from: './src/features', except: ['./reviews'] },
    { target: './src/features',         from: './src/app' },
  ],
}],
```

> In DevDigest the equivalent boundary is directional. Imports may go **up** the route tree — a
> nested route using an ancestor route's `_components/` is fine and does not trigger promotion.
> A **sibling** route's `_components/`, or an **ancestor** reaching down into a descendant's, is
> a violation; promote to `src/components/`. See [SKILL.md](SKILL.md) §14.

---

## No Barrel Files

```ts
// BAD: resolving one import makes the bundler pull in every re-exported module.
// src/components/index.ts
export * from './run-cost-badge';
export * from './severity-counters';
export * from './diff-viewer';
export * from './app-shell';

import { RunCostBadge } from '@/components';   // ← loads all four subtrees
```

```ts
// GOOD: direct import. The bundler loads exactly one module,
// and the path says where the symbol actually lives.
import { RunCostBadge } from '@/components/run-cost-badge/RunCostBadge';
```

> Applies to new and touched code. Existing `index.ts` files stay until someone asks for the
> migration — see [SKILL.md](SKILL.md) §12.
