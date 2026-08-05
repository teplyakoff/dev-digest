---
name: deprecation-policy
description: Flag a public thing deleted outright where a deprecation window was owed.
type: convention
allowed-tools: ["Bash", "Write"]
hooks:
  post-review: ./notify.sh
model: claude-opus-4
---

# Deprecation policy

The other contract skills ask whether a change breaks a caller. This one asks a
narrower question: when something public goes away, was anyone told first?

A silent deletion and a deprecation are the same diff minus one release. The
difference is entirely in whether a caller had a window to move.

## Flag these

- A public route, export, field or enum member is REMOVED in the same change that
  introduced its replacement. The replacement is fine; the removal is early.
- Something is removed that was never marked deprecated anywhere — no `@deprecated`
  tag, no `Deprecation` / `Sunset` header, no note in a changelog or migration guide.
- A deprecation is ADDED and the thing is removed in the same diff. That is a
  deletion wearing a label.
- A deprecation notice with no replacement named. "Deprecated" without "use X
  instead" leaves the caller nowhere to go.
- A deprecation with no date or version attached, so it can never be enforced and
  will still be there in two years.

## Do not flag

- Removing something that was already marked deprecated in an earlier release —
  that is the policy working. If the diff removes a `@deprecated` symbol, look for
  when it was marked; if you cannot tell from this diff, say so rather than
  guessing.
- Anything internal: a non-exported function, a private field, a route behind an
  auth boundary no external client reaches.
- Dead code with no callers anywhere, deleted cleanly.

## Good / bad

BAD — the old name disappears in the same commit that adds the new one:

```ts
- export function getSkillAgents(id: string): Promise<Agent[]>
+ export function getSkillUsage(id: string): Promise<Usage[]>
```

GOOD — both exist, the old one says where to go and when it ends:

```ts
  /** @deprecated Use `getSkillUsage`. Removed in 4.0.0 (2026-12-01). */
  export function getSkillAgents(id: string): Promise<Agent[]>
+ export function getSkillUsage(id: string): Promise<Usage[]>
```

For an HTTP route the equivalent is keeping the path and answering with
`Deprecation: true` and a `Sunset` date header, not a 404.

## Reporting

- WARNING for a silent removal of something public. It is not CRITICAL on its own
  — `breaking-change` already reports the break; this adds the reason it was
  avoidable.
- SUGGESTION for a deprecation that is missing its replacement or its date.
- Say what the deprecation should have said: the replacement, and the release or
  date the removal happens.
- One finding per removed thing. Do not restate the whole policy.
