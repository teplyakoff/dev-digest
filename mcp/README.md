# `@devdigest/mcp` — DevDigest as MCP tools

A local **stdio** MCP server that puts five DevDigest tools in front of any MCP
client (Claude Code, Claude Desktop, …). It is a thin adapter over the REST API
at `http://localhost:3001`: no database pool, no secrets file, no model.

```
MCP client ──stdio(JSON-RPC)──▶ devdigest-mcp ──HTTP──▶ @devdigest/api :3001
```

## What starts it, and what does not

Two things are true and easy to confuse:

- **The tools are registered automatically.** `.mcp.json` in the repo root is
  auto-discovered by Claude Code, so every session opened in this directory has
  the five tools without any flag. That is deliberate — the deliverable should
  be there when you need it — and it is paid for by every session, including
  ones that will never call it. The number is in [token cost](#token-cost).
- **`./scripts/dev.sh` still never starts this server.** It boots Postgres, runs
  the migrations, seeds, and starts the API and the web client; `scripts/`
  contains no reference to `mcp` at all. The *client* spawns the server, on
  demand, over stdio. Starting the app and starting the tools are unrelated
  events, and neither implies the other.

The consequence worth internalising: with a session open and no API running,
every tool answers with the same actionable error rather than a stack trace.
That is not the server failing to start — it started fine and has nothing to
talk to.

To run a session **without** the tools: `claude --strict-mcp-config`.

## From scratch

### 1. What you need

| | Why |
|---|---|
| Node ≥ 22 | `tsx` runs the server's TypeScript directly; nothing is compiled |
| Docker | only for the API's Postgres, not for this package |
| `pnpm` | the API and the web client use it |
| `npm` | this package uses it — one lockfile each, do not cross them |

### 2. Install this package once

```sh
cd mcp && npm install
```

Nothing else in the repo installs it: `mcp/` is a standalone package with its own
`package-lock.json`, so a `pnpm install` at the root will not create
`mcp/node_modules`. Skipping this step is the most common failure, and the
launcher names it:

> devdigest-mcp: dependencies are missing — run 'cd /…/mcp && npm install'

### 3. Check the server on its own, with no client and no API

The API does not have to be running for this — `tools/list` makes no HTTP call:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| mcp/bin/devdigest-mcp
```

You get two JSON-RPC replies: `serverInfo` naming `devdigest 0.1.0`, and five
tools. If instead the terminal just sits there, that is also correct — a stdio
server waits on stdin forever, which is why `npm start` on its own looks like a
hang. It speaks JSON-RPC, not English.

### 4. Start the API — the server is useless without it

In its own terminal, and leave it running:

```sh
./scripts/dev.sh --no-client      # Postgres → migrate → seed → API on :3001
```

`--no-client` skips Next.js, which the tools never touch. Every tool answers
with an actionable error rather than a stack trace when the API is down:

> Cannot reach the DevDigest API — the DevDigest API is not running; start it
> with `./scripts/dev.sh` (or `cd server && pnpm dev`).

Two things `dev.sh` will not do for you: it does **not** run migrations on boot
in the API process (`relation ... does not exist` → `cd server && pnpm db:migrate`),
and it leaves Postgres running after Ctrl-C. Stop that with `docker compose stop`
— never `docker compose down -v`, which deletes the volume and every imported
repo and review with it.

### 5. Start a client session

From the repo root, in a second terminal:

```sh
claude
```

That is the whole step. `.mcp.json` is auto-discovered, so the tools are there.
The first time a project server appears, the client asks whether to trust it —
approve it once and it stays approved for the project.

Verify by calling `list_agents`. With the API up you get the workspace's agents;
with it down you get the error quoted above — either way the tool is wired, and
that error is the fastest way to tell "server did not start" from "server
started and the API is missing".

Two flags worth knowing:

| | |
|---|---|
| `claude --strict-mcp-config` | run **without** these tools, and without any of your other MCP servers |
| `claude --mcp-config <file>` | load a server from an explicit file, e.g. to point at a different API |

Note that `claude mcp list` shows your stored user- and plugin-level servers; do
not use it to confirm this one. Call a tool instead.

### 6. Point it somewhere else (rarely)

Edit `env.DEVDIGEST_API_URL` in `.mcp.json`, or override it for one session with
an explicit config file:

```sh
claude --mcp-config /path/to/other.mcp.json --strict-mcp-config
```

Only loopback hosts are accepted — `localhost`, `127.0.0.1`, `::1`. Anything else
is refused at startup, because the API authenticates nobody: a non-local base URL
would ship this workspace's pull-request data to a third party through a tool the
user believes is local.

## How the launcher works

`mcp/bin/devdigest-mcp` resolves its own directory and `exec`s the package-local
`tsx` on `src/main.ts`, so the server runs with `mcp/` as its cwd whatever the
client's cwd is. That is what makes the tsconfig `paths` aliases resolve. `exec`
matters too: the client talks JSON-RPC over this process's stdio and signals its
termination, and a wrapper that stayed alive as a parent would sit between them.

The config is a normal MCP entry — copy it into any other client, replacing the
relative `command` with an absolute path if that client will not run one:

```json
{ "mcpServers": { "devdigest": {
    "command": "mcp/bin/devdigest-mcp",
    "args": [],
    "env": { "DEVDIGEST_API_URL": "http://localhost:3001" },
    "timeout": 960000 } } }
```

### Why `timeout` is in there, and why it is 960 000

`timeout` is a per-server **tool-call** wall clock in milliseconds, and it is the
only half of the timeout story this repo controls. `MCP_TIMEOUT` is the client's
*startup* budget and is a different number; `MCP_TOOL_TIMEOUT` is the same wall
clock set globally, which this key overrides for this server alone.

960 000 ms is `MAX_WAIT_SECONDS` (900) plus a minute. The ordering is the whole
point: **this server's own timeout must fire first.** When it does,
`run_agent_on_pull_request` returns `isError: true` carrying the `run_id`s, so
the work is recoverable with `get_findings`. When the client's fires first, the
call is aborted from outside and the caller gets no ids at all — the runs are
still billed and still finish, and nothing says where they went.

Do not assume progress notifications cover this. They reset a *client's* idle
accounting and, in an SDK client, a `resetTimeoutOnProgress` deadline — but a
per-server `timeout` in Claude Code is a hard wall clock that progress does not
extend. Raising `max_wait_seconds` without raising this number reintroduces
exactly the failure it is here to prevent.

## The five tools

| Tool | What it does | Reads or writes |
|---|---|---|
| `list_agents` | The workspace's review agents: model, enabled, linked skill count | read |
| `get_findings` | Findings for a PR, filterable by severity / category / path / status / run | read |
| `get_conventions` | A repo's extracted conventions, with the evidence line each cites | read |
| `run_agent_on_pull_request` | Runs one agent (or all) and **blocks** until the runs settle | **writes, calls GitHub and an LLM, spends money** |
| `get_blast_radius` | What else a PR can reach: changed symbols → callers → downstream endpoints and crons | read |

Every identifier is flexible: a GitHub URL, `owner/repo` plus a number, or a
UUID. On a miss the error lists the candidates it actually saw, so the model can
correct itself instead of guessing.

### `get_findings` unions agents but not re-runs

A `reviews` row is one AGENT, not one review pass, and the rows are appended —
re-running an agent adds a row rather than replacing one. So the tool treats the
two axes differently, and the difference is the whole design:

- **Across agents it always unions.** Reading a single row reports whichever
  agent finished last, which on `teplyakoff/dev-digest#5` was the one with 0
  findings on a PR that had 13 (`server/INSIGHTS.md:343-356`).
- **Within one agent the newest run wins**, because an older row is a verdict
  the agent has already replaced, and showing both double-counts it.

`all_runs: true` returns the history instead. Either way the header states the
scope, and a default answer that dropped rows says how many it dropped — a total
that quietly shrank is indistinguishable from an agent that found less.

### `run_agent_on_pull_request` is genuinely blocking

`POST /pulls/:id/review` is fire-and-forget on the server — it returns run ids
immediately and `reviews: []` always. This tool polls `GET /pulls/:id/runs`,
filtered to the run ids it was given, until each is `done`, `failed` or
`cancelled`.

`max_wait_seconds` defaults to **900**, and that is not padding: two real runs in
this repo's history took **945 s** and **674 s** against a typical 8–99 s
(`server/INSIGHTS.md`). Three things make a wait that long survivable:

- **A client timeout set above ours.** `.mcp.json` carries `"timeout": 960000`,
  so the server's own 900 s deadline is always the one that fires — see
  [above](#why-timeout-is-in-there-and-why-it-is-960000). This is the load-bearing
  one, because the other two do not cover it.
- **Progress notifications.** When the client sends a `progressToken`, every
  poll tick emits progress. That resets a client's idle accounting, and in an
  SDK client a `resetTimeoutOnProgress` deadline — but **not** a per-server
  `timeout`, which is a hard wall clock progress does not extend.
- **Cancellation.** `extra.signal` is honoured on every tick; the tool stops at
  once and hands back the `run_id`s so `get_findings` can pick the work up.

On timeout it returns `isError: true` **with the run ids**. It never cancels the
runs — `POST /runs/:id/cancel` frees the executor but does not abort the request
in flight, so a cancel would bill the run and throw the result away.

### `get_blast_radius` errors instead of reporting an empty map

It reads `GET /pulls/:id/blast` — the same route the web client's Blast tab
renders, so the two cannot disagree. The server computes that map from its
persistent code index and calls no model, which is why this tool is cheap enough
to run before a review rather than after one.

It was a registered stub through most of L04, on the grounds that a visibly
unimplemented tool reports its own absence while a hidden one is
indistinguishable from a caller who never thought to ask. The route landed in
the same lesson and the body was replaced, in that order.

**What survives from the stub is the rule, not the failure.** The route answers
`200` with `status: "degraded"` for a repository that has never been indexed,
and this tool turns that into `isError: true` carrying the server's own reason.
That is deliberate: the reader here is another model, and "no callers found"
is a claim about the code that an absent index has not earned. A `partial`
index answers normally, with the caveat inline.

## Token cost

<a id="token-cost"></a>

Tool definitions are injected into the **system prompt of every chat that loads
them**, so the five cost **1 967 measured tokens** — serialised `tools/list` from
the running server, 7 868 characters at ~4 chars/token, against an earlier
estimate of ~1 650.

Because `.mcp.json` is committed and auto-discovered, that is charged to **every**
session in this repo — `implementation-planner`, `researcher` and the review agents included,
none of which can call these tools. That is the deliberate trade: the tools are
always there, and the price is always paid. `claude --strict-mcp-config` is the
per-session opt-out, and it is worth reaching for when a session is not about
DevDigest at all.

Measured per tool, from the same payload:

| Tool | Tokens | Estimated | |
|---|---:|---:|---|
| `run_agent_on_pull_request` | **509** | ~550 | the only `outputSchema` |
| `get_findings` | **500** | ~405 | eight filters; `all_runs` cost 33 |
| `get_conventions` | **424** | ~285 | the `ConventionStatus \| 'all'` union costs more than a plain enum |
| `get_blast_radius` | **275** | ~185 | was 221 as a stub; a real schema and a real description cost 54 more |
| `list_agents` | **258** | ~225 | 260 until the `provider` projection came out |
| | **1 967** | ~1 650 | |

(The per-tool column sums to slightly more than the total: each row is measured
on its own serialised object, the total on the serialised array. The **total** is
what the budget is about.)

**33 tokens of headroom, and that is the whole story of this table.** L04 spent
54 of the original 64 turning `get_blast_radius` from a stub into a working tool;
L05 spent 31 more on `all_runs`, and that one had to be paid — without it the
tool could not report a re-run at all. What is left will not absorb another
filter on another tool. The next change that needs room takes it from
`get_conventions` (424 tokens for one read, the worst ratio here) rather than
from the budget.

Budget: **2 000 tokens**. Going over is a defect, not a fact of life. What holds
it there, strongest first: exactly five tools; `instructions` omitted; exactly
one `outputSchema` (`run_agent_on_pull_request` — on `get_findings` the `Finding`
shape would cost ~400 on its own); flat schemas, so the generated JSON Schema has
no `$defs`; enums taken from the existing contracts instead of free strings; the
server name is `devdigest`, because every call pays for
`mcp__devdigest__<tool>`; and no description longer than six lines.

To run a session **without** these tools: start `claude` normally. That is the
default, and it is the point of the opt-in arrangement.

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
