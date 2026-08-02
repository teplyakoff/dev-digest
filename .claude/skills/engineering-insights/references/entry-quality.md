# Routing, sections and entry format

## Which file gets the entry

| Files the task touched | Target |
|---|---|
| `server/**` | `server/INSIGHTS.md` |
| `client/**` | `client/INSIGHTS.md` |
| `reviewer-core/**` | `reviewer-core/INSIGHTS.md` |
| `e2e/**` | `e2e/INSIGHTS.md` |
| `demo/**` | `demo/INSIGHTS.md` |
| `server/src/modules/repo-intel/**` | `server/INSIGHTS.md` |

`repo-intel` is a module, not a package, and has no file of its own — its
`CLAUDE.md` sends insights up to the server's. Do not create one for it.

**Cross-cutting lessons** (a pnpm quirk, a script both packages run) go into
every package they affect, **reworded for that package** — a reader of
`client/INSIGHTS.md` must not have to reason about the server to use the entry.
The pnpm 11 `ERR_PNPM_IGNORED_BUILDS` entry, present in both `server/` and
`client/` with different `allowBuilds:` lists, is the precedent.

**Meta-work has no target.** Changes confined to `.claude/`, `docs/agent-prompts/`
or the root `CLAUDE.md` touch no package. Write nothing and say why — do not
force the lesson into whichever file happens to be closest.

## The seven sections

Fixed order, present in every file, do not add or rename:

- **What Works** — an approach or command that proved out.
- **What Doesn't Work** — dead ends and antipatterns. This is the section people
  skip and the most valuable one: it is the only place that saves the next
  session from repeating an experiment that already failed.
- **Codebase Patterns** — conventions and architectural decisions, with the why.
- **Tool & Library Notes** — dependency and tooling quirks.
- **Recurring Errors & Fixes** — an error string, then its fix.
- **Session Notes** — dated narrative summaries.
- **Open Questions** — what is still unresolved.

## Exact format

Match the entries already in the file. Taken from the committed files:

- Regular sections — a `-` bullet, hard-wrapped at ~80 columns, the key term in
  `**bold**`, trailing ` (YYYY-MM-DD)` on the last line:

  ```
  - `relation ... does not exist` on a fresh boot → migrations were never applied.
    The server does not migrate on boot by design. Run `pnpm db:migrate`. (2026-07-27)
  ```

- `## Session Notes` — the date leads and there is no trailing date:

  ```
  - **2026-07-27** — First boot from zero on this machine. Docker Desktop was not
    running; after starting it, Postgres, migrations and seed all came up clean.
  ```

- `## Open Questions` — no date at all.

- The `_(no entries yet)_` placeholder is **removed** when a section gets its
  first entry. Leaving it above a real bullet is a bug.

Use the current date. If it is not already known from the session context, get
it with `date +%F` rather than guessing.

## Append-only

Existing entries are never rewritten, reordered or deleted — in a team that
produces merge conflicts and silently erased lessons.

A lesson that turns out to be wrong or outdated is **superseded**, not edited:
add a new dated entry that names the old one explicitly, e.g. "supersedes the
2026-07-27 note on X — since <library> 3.2 the opposite holds." Two entries that
contradict each other without saying so leave the next agent to pick at random.

## Keeping it lean

- **Dedupe** before appending — read the whole file, skip anything already covered.
- **Prune** is a human decision. An upgraded library turns old quirk notes into
  noise, or worse, harmful advice; surface the stale entries you notice instead
  of deleting them yourself.
- Past ~200 entries, or once a file no longer fits comfortably in one read, the
  signal-to-noise ratio drops. Say so and propose a split into domain files
  (`INSIGHTS-<domain>.md`) — never split one silently.

## Vague vs useful

| Don't write | Write instead |
|---|---|
| "Promises can be tricky" | "`Promise.all()` on the ingest pipeline times out past 30 items — use `Promise.allSettled()` in batches of 10" |
| "be careful with async" | "checkout-flow state always goes through Zustand (`cartStore.ts`), because 3 components share the cart; local state does not work here" |

The test for every candidate: *if this would be obvious to anyone reading the
code, don't write it.*
