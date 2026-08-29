---
name: dependency-checker
description: "Analyzes dependencies across this repo's six standalone packages (server, client, reviewer-core, mcp, e2e, demo) — both external npm packages and internal cross-package imports — and produces a structured report: a Mermaid dependency graph, a size/type breakdown table, and prioritized findings (unused deps, version drift, boundary-bypassing internal imports) with a concrete summary. Use this whenever the user asks to check, audit, analyze, or clean up dependencies, wants to know what's pulling in bloat, asks how packages depend on each other, or wants a dependency graph or dependency report — even if they just say 'check our dependencies' or 'why is node_modules so big'."
---

# Dependency Checker — external and internal dependencies, sized and prioritized

Answers three questions in one report: **what does each package depend on, how much does
it cost, and what here is actually a problem worth fixing?**

This repo is **not a monorepo** — six packages (`server/`, `client/`, `reviewer-core/`,
`mcp/`, `e2e/`, `demo/`), each with its own lockfile and manager (see root `CLAUDE.md`).
There is no `workspace:*` and no single `npm ls` that sees across all of them. That absence
is the reason this skill exists: nothing in the repo draws this graph for you, so it has to
be built by reading each package's manifest and grepping its source.

- Mermaid syntax help → [mermaid-diagram](../mermaid-diagram/SKILL.md). This skill only says
  *what* the graph must show, not how to write flowchart syntax.
- A full worked example report on a small fictional repo → [references/example-report.md](references/example-report.md)

## Severity Levels

- **P0** — Actively wrong or risky: an internal import that reaches past a package's public
  surface into its guts, a security-relevant stale dependency, or a dependency declared but
  never used at all (dead weight with no offsetting benefit)
- **P1** — Costs real bytes or real confusion but isn't broken: heavy dependencies with a
  lighter equivalent, version drift on a shared contract package
- **P2** — Worth knowing, not worth a dedicated fix: minor drift on a low-stakes package,
  a large dependency that's large because of what it legitimately does
- **Info** — Neutral facts the reader needs for context: total size, package count

---

## 1. Scope, first

State which packages are in scope before analyzing anything. Default to all packages the
repo actually has (check what directories exist with a `package.json` — don't assume the
CLAUDE.md list is current). If the user names specific packages ("check server and client"),
scope to those and say so — don't silently expand back to all six.

## 2. Gather the data yourself — don't ask the user to fetch it

Unless the data has already been handed to you in the conversation (a pasted `package.json`,
a `du -sh` dump, etc.), collect it with these commands, per package. There's no shortcut
through a package manager's own graph command, because there's no single graph — each
package only knows about itself.

**External dependencies and their declared versions:**
```bash
cat server/package.json client/package.json reviewer-core/package.json mcp/package.json e2e/package.json demo/package.json
```
Read `dependencies` and `devDependencies` separately — that distinction belongs in the
report (a heavy devDependency like `playwright` costs disk but never ships).

**Installed size, per package's `node_modules`:**
```bash
du -sh <package>/node_modules/* 2>/dev/null | sort -rh | head -30
```
Run per package rather than once at the repo root — sizes are meaningless without knowing
which package pays for them, and a dependency can be hoisted differently in each lockfile.

**Whether a declared dependency is actually imported (catches unused ones):**
```bash
grep -rl "from ['\"]<pkg-name>" <package>/src | head
```
A dependency in `package.json` with zero matches under `src/` is a P0 candidate — but check
it isn't used in a config file, a script, or as a peer dependency of something else before
calling it dead.

**Internal cross-package edges** — the graph a package manager can't give you here:
```bash
grep -rn "reviewer-core/src\|\.\./\.\./reviewer-core\|@shared/" server/src client/src --include='*.ts' --include='*.tsx'
```
Adjust the pattern per package pair. What you're looking for is described in §3 — this
command just finds candidates; read each hit to classify it.

If a command comes back empty, that's a finding in itself (e.g. "no import of `moment`
found under `server/src`") — don't drop it, put it in §5.

## 3. Two different kinds of dependency — don't conflate them (P0 if mixed up)

**External dependencies** are npm packages, each package's own `package.json` declares them,
and they're versioned and sized independently per package (that's *why* `zod@3.23.8` in
`server/` and `zod@3.22.4` in `client/` are two different installs, not one).

**Internal dependencies** are how these packages reach each other's code without a workspace
protocol. Per root `CLAUDE.md`, that happens two ways:
- **TypeScript path aliases** to a *vendored copy* — `server/src/vendor/shared` is the
  source of Zod contracts, hand-copied into `client/src/vendor/shared` by
  `./scripts/vendor-shared.sh`. This is a real dependency (client's copy must track
  server's) even though no `package.json` names it.
- **A relative import reaching into another package's `src/`** — e.g. `server/`
  importing `reviewer-core/src/pipeline.js` directly by path instead of through whatever
  `reviewer-core` exposes as its public entry point. This is the boundary-bypass case:
  finding it is P0 (§5), because it means the "package" boundary is fiction for that one
  import — a change inside `reviewer-core`'s internals can break `server` with no version
  bump to signal it.

Never describe these as `workspace:*` links, a monorepo, or anything a package manager
tracks — say explicitly that they were found by reading imports, because that's the only
way they exist.

## 4. The report

Produce the report in this order. Every section is required — a report missing the graph or
the severity tiers is not done, it's a partial draft.

### Scope
One or two sentences: which packages, and (if relevant) what was explicitly excluded and why.

### Dependency graph
A Mermaid `flowchart` (see [mermaid-diagram](../mermaid-diagram/SKILL.md) for syntax) with
one node per package. Draw an edge for every internal dependency found in §3 — label it with
what crosses (`@shared/review-types`, a relative import path) so the edge means something
specific, not just "these are related." Don't put every external npm package on this graph;
it exists to show package-to-package structure, not the full node_modules tree. If an
external dependency is itself the finding (e.g. it's huge, or duplicated), it can get its own
node, but that's the exception.

### Size & type breakdown
One table (or one per package, whichever reads clearer given the count) with these columns:
package, dependency name, version, `dependencies` or `devDependencies`, installed size. Sort
by size descending within each package so the reader sees the expensive ones first. A vague
"client's node_modules is large" is not this section — the table's rows are the size
statement.

### Findings & Priorities
Group every finding under **P0 / P1 / P2 / Info** headings (§ "Severity Levels" above) — an
unranked bullet list is not this section, even if every individual bullet is accurate. Every
finding names the specific package, dependency, and/or file it's about. "Consider optimizing
dependencies" is not a finding; "`moment` is declared in `server/package.json` but `grep`
found no import of it under `server/src`" is.

Check for, at minimum:
- **Unused dependency** — declared, not imported (§2).
- **Version drift** — the same package resolved to different versions across packages,
  worth flagging even when nothing is broken yet, because it means a bug fix in one place
  silently doesn't apply to the other.
- **Boundary-bypassing internal import** — §3's relative-import-into-another-package's-`src/`
  case.
- **Heavy dependency for what it's used for** — a large installed size relative to what the
  package actually needs it to do, especially in a package that ships to a browser.

### Summary
3–5 takeaways, ordered by priority (P0 first), each one a concrete action naming a specific
package/dependency/file. Phrase every action as a **recommendation for the user to decide
on** ("consider removing `moment` from `server/package.json` — no import found; confirm
before deleting" or "align `client`'s `zod` to `3.23.8` to match `server`/`reviewer-core`"),
never as something already done. This skill reads and reports; it does not edit
`package.json` or delete anything on its own.

## 5. What "good" looks like, and what doesn't

- A finding that says *where* — a file, a package, a version number — every time. If you
  can't name the location, you haven't verified the finding yet; go grep it.
- Severity that reflects actual blast radius, not alphabetical or file order. A boundary
  bypass into another package's internals is worse than a devDependency being 20MB.
- Internal and external dependencies never described with the same words. If a sentence
  could apply to either without changing, it hasn't actually classified anything (§3).
- Recommendations that name the exact edit, not the general direction. "Reduce bundle
  size" gives the reader nothing to do Monday morning; "swap `date-fns` for the three
  functions actually used, or confirm the full library earns its ~22M" does.
