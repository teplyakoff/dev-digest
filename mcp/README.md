# `@devdigest/mcp` — DevDigest as MCP tools

A local **stdio** MCP server that puts five DevDigest tools in front of any MCP
client (Claude Code, Claude Desktop, …). It is a thin adapter over the REST API
at `http://localhost:3001`: no database pool, no secrets file, no model.

```
MCP client ──stdio(JSON-RPC)──▶ devdigest-mcp ──HTTP──▶ @devdigest/api :3001
```

## Prerequisites

The API must be running — `./scripts/dev.sh` (or `--db-only` plus
`cd server && pnpm dev`). Every tool answers with an actionable error instead of
a stack trace when it is not:

> the DevDigest API is not running; start it with `./scripts/dev.sh`

## Install and run

```sh
cd mcp && npm install
npm start            # stdio server on this terminal; it speaks JSON-RPC, not English
```

`.mcp.json` at the repo root registers it for Claude Code:

```json
{ "mcpServers": { "devdigest": {
    "command": "mcp/bin/devdigest-mcp",
    "args": [],
    "env": { "DEVDIGEST_API_URL": "http://localhost:3001" } } } }
```

`mcp/bin/devdigest-mcp` resolves its own directory and `exec`s the package-local
`tsx` on `src/main.ts`, so the server runs with `mcp/` as its cwd whatever the
client's cwd is. That is what makes the tsconfig `paths` aliases resolve. If a
client will not run a relative `command`, put the absolute path there instead.

## The five tools

| Tool | What it does | Reads or writes |
|---|---|---|
| `list_agents` | The workspace's review agents: provider, model, enabled, linked skill count | read |
| `get_findings` | Findings for a PR, filterable by severity / category / path / status | read |
| `get_conventions` | A repo's extracted conventions, with the evidence line each cites | read |
| `run_agent_on_pull_request` | Runs one agent (or all) and **blocks** until the runs settle | **writes, calls GitHub and an LLM, spends money** |
| `get_blast_radius` | Always fails. See below | — |

Every identifier is flexible: a GitHub URL, `owner/repo` plus a number, or a
UUID. On a miss the error lists the candidates it actually saw, so the model can
correct itself instead of guessing.

### `run_agent_on_pull_request` is genuinely blocking

`POST /pulls/:id/review` is fire-and-forget on the server — it returns run ids
immediately and `reviews: []` always. This tool polls `GET /pulls/:id/runs`,
filtered to the run ids it was given, until each is `done`, `failed` or
`cancelled`.

`max_wait_seconds` defaults to **900**, and that is not padding: two real runs in
this repo's history took **945 s** and **674 s** against a typical 8–99 s
(`server/INSIGHTS.md`). Two things make a wait that long survivable:

- **Progress notifications.** When the client sends a `progressToken`, every
  poll tick emits progress. Clients that set `resetTimeoutOnProgress` reset
  their own timeout on each one.
- **Cancellation.** `extra.signal` is honoured on every tick; the tool stops at
  once and hands back the `run_id`s so `get_findings` can pick the work up.

On timeout it returns `isError: true` **with the run ids**. It never cancels the
runs — `POST /runs/:id/cancel` frees the executor but does not abort the request
in flight, so a cancel would bill the run and throw the result away.

### `get_blast_radius` always returns an error, on purpose

There is no HTTP endpoint for blast radius. The facade exists
(`server/src/modules/repo-intel/service.ts`) but `repo-intel/routes.ts` registers
only `/repos/:id/index-state` and `/repos/:id/resync`. The tool is registered and
visible so its absence is *reported* rather than silent, and it invents nothing.
Implementing it needs a new server route first — that is a later lesson.

## The cost of committing `.mcp.json`

`.mcp.json` is committed deliberately: the lesson's deliverable has to be visible
to whoever clones the repo. The price is real and worth stating.

Tool definitions are injected into the **system prompt of every chat**, so these
five cost roughly **1 650 tokens in every agent session in this repo** — including
`planner`, `researcher` and the review agents, none of which need them.

| Tool | Name | Description | Input | Output | Annotations | Total |
|---|---:|---:|---:|---:|---:|---:|
| `list_agents` | ~9 | ~110 | ~90 | — | ~15 | **~225** |
| `run_agent_on_pull_request` | ~12 | ~170 | ~200 | ~150 | ~15 | **~550** |
| `get_findings` | ~9 | ~130 | ~250 | — | ~15 | **~405** |
| `get_conventions` | ~9 | ~110 | ~150 | — | ~15 | **~285** |
| `get_blast_radius` | ~10 | ~90 | ~70 | — | ~15 | **~185** |
| | | | | | | **~1 650** |

Budget: **2 000 tokens**. Going over is a defect, not a fact of life. What holds
it there, strongest first: exactly five tools; `instructions` omitted; exactly
one `outputSchema` (`run_agent_on_pull_request` — on `get_findings` the `Finding`
shape would cost ~400 on its own); flat schemas, so the generated JSON Schema has
no `$defs`; enums taken from the existing contracts instead of free strings; the
server name is `devdigest`, because every call pays for
`mcp__devdigest__<tool>`; and no description longer than six lines.

To run a session **without** these tools:

```sh
claude --strict-mcp-config          # ignore every .mcp.json / user MCP config
```

## Response size

`src/format.ts` holds `CHARACTER_LIMIT = 25 000` **characters** — about 6 000
tokens at ~4 chars/token, comfortably inside Claude Code's ~25 000-**token**
response cap. Truncation is a backstop, not the control: `response_format:
'concise'` and `limit` are. When it does trip, the message names the exact
parameters that would narrow the query.

## Testing

```sh
cd mcp && npm test          # hermetic: zero HTTP, zero spend, fake timers
```

`FakeApiClient` (`src/api/fake-client.ts`) is production code, not a fixture —
it and the real client both `implements ApiClient`, so a change to the port
breaks the double at compile time. There are no `*.it.test.ts` files here and
there must not be: in this repo that suffix means DB-backed via testcontainers.
