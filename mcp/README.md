# `@devdigest/mcp` — DevDigest as MCP tools

A local **stdio** MCP server that puts five DevDigest tools in front of any MCP
client (Claude Code, Claude Desktop, …). It is a thin adapter over the REST API
at `http://localhost:3001`: no database pool, no secrets file, no model.

```
MCP client ──stdio(JSON-RPC)──▶ devdigest-mcp ──HTTP──▶ @devdigest/api :3001
```

## This server is opt-in, and nothing starts it for you

Two things are true and easy to confuse:

- **`./scripts/dev.sh` never starts this server.** It boots Postgres, runs the
  migrations, seeds, and starts the API and the web client. `scripts/` contains
  no reference to `mcp` at all. Starting the app has never started the tools.
- **The config is not auto-discovered either.** It lives at
  `mcp/devdigest.mcp.json`, *not* at `.mcp.json` in the repo root. Claude Code
  auto-loads a root `.mcp.json` for every session in the directory; this one it
  will not touch unless you name it on the command line.

So the tools exist when you ask for them and cost nothing when you don't. The
price of the other arrangement is in [the token cost](#token-cost) below — it is
why this one was chosen.

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

### 5. Start a client session with the tools

From the repo root, in a second terminal:

```sh
claude --mcp-config mcp/devdigest.mcp.json --strict-mcp-config
```

- `--mcp-config` loads this server for this session only.
- `--strict-mcp-config` drops **every other** MCP server you have configured —
  globally, per-user, from plugins. On a machine with a dozen connectors that is
  usually a far bigger context saving than these five tools cost. Leave it off if
  you need your other servers in the same session.

Verify inside the session by calling `list_agents`. With the API up you get the
workspace's agents; with it down you get the error quoted above — either way the
tool is wired. Note that `claude mcp list` will **not** show it: that subcommand
reads the stored configurations and ignores `--mcp-config`.

### 6. Point it somewhere else (rarely)

```sh
DEVDIGEST_API_URL=http://127.0.0.1:4001 claude --mcp-config mcp/devdigest.mcp.json
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
    "env": { "DEVDIGEST_API_URL": "http://localhost:3001" } } } }
```

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

## Token cost

<a id="token-cost"></a>

Tool definitions are injected into the **system prompt of every chat that loads
them**, so the five cost **1 871 measured tokens** — serialised `tools/list` from
the running server, 7 481 characters at ~4 chars/token, against an earlier
estimate of ~1 650.

That number is the reason the config sits at `mcp/devdigest.mcp.json` rather than
at `.mcp.json` in the root. Auto-discovery would charge it to **every** session in
this repo, `planner`, `researcher` and the review agents included, none of which
can use these tools. Opt-in inverts the default: you pay when the session is
about DevDigest, and the rest pay nothing.

Measured per tool, from the same payload:

| Tool | Tokens | Estimated | |
|---|---:|---:|---|
| `run_agent_on_pull_request` | **499** | ~550 | the only `outputSchema` |
| `get_findings` | **467** | ~405 | seven filters |
| `get_conventions` | **424** | ~285 | the `ConventionStatus \| 'all'` union costs more than a plain enum |
| `list_agents` | **261** | ~225 | |
| `get_blast_radius` | **221** | ~185 | |
| | **1 871** | ~1 650 | |

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
