/**
 * DevDigest screencast recorder — L04: the `@devdigest/mcp` stdio server, seen
 * through the MCP Inspector.
 *
 * What it films, in one pass: a disconnected STDIO server card, the handshake,
 * the capabilities the server actually advertises, the five tools with their
 * annotations, and four real `tools/call` round-trips with the JSON-RPC traffic
 * visible in the protocol sidebar the whole time.
 *
 * FREE, unlike `record` and `record:conventions`. Every tool it executes is
 * read-only: `list_agents`, `get_findings`, `get_conventions` and
 * `get_blast_radius`. `run_agent_on_pull_request` is opened so its form and its
 * cost warning are on screen, and deliberately NOT executed: filming is not
 * where a review budget gets spent, and a run recorded live would be a
 * different run from the one the evidence cites.
 *
 * `get_blast_radius` used to be filmed FAILING — it was the unimplemented slot,
 * and the error was the evidence. L04 gave it a server route, so the shot now
 * has to prove the opposite: real callers, cited by file and line. If it ever
 * comes back red on an indexed repository, the recorder is telling the truth
 * and something upstream broke.
 *
 * Re-runnable: it spawns its own Inspector on a free port and kills it in a
 * `finally`, so nothing is left listening. It writes nothing to the DevDigest
 * database.
 *
 * Prereqs: the API is up (`../scripts/dev.sh --no-client`), `npm run setup` has
 * fetched Chromium, `cd ../mcp && npm install` has been done once, and the
 * target repo and PR are imported.
 *
 * Env (all optional):
 *   DEMO_API_URL         API origin        default http://localhost:3001
 *   DEMO_OUT             output dir        default ./recordings/l04-mcp
 *   DEMO_REPO            repo full_name    default teplyakoff/dev-digest
 *   DEMO_PR              PR number         default 4
 *   DEMO_INSPECTOR_URL   reuse a running Inspector instead of spawning one
 *                        (must include its MCP_INSPECTOR_API_TOKEN)
 *   DEMO_HEADED          "1" to watch      default headless
 *
 * Usage:
 *   npm run record:mcp
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l04-mcp");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 4);
const HEADED = process.env.DEMO_HEADED === "1";
const REUSE_URL = process.env.DEMO_INSPECTOR_URL ?? null;

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";

/** The tool that costs money. Filmed, never executed — see the header. */
const COSTLY_TOOL = "run_agent_on_pull_request";

/**
 * Pinned, not floating. `npx -y <name>` would fetch and execute whatever the
 * registry serves at record time, with full Node access and outside every
 * lockfile in this repo. It is also what makes the take reproducible: these
 * frames are of one specific Inspector UI, and a screencast whose tool version
 * is unnamed is weaker evidence. Bump deliberately, then re-record.
 */
const INSPECTOR_PKG = "@modelcontextprotocol/inspector@2.2.0";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

function log(msg: string) {
  console.log(`\x1b[36m•\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
}

// ---------------------------------------------------------------------------
// The Inspector process
// ---------------------------------------------------------------------------

/**
 * Kill the Inspector and everything it spawned.
 *
 * Always the process GROUP: `npx` is a launcher, the server that holds the port
 * is its child, and signalling only the npx pid leaves that child listening on
 * :6274 — which is precisely what stops the *next* recording from starting. Two
 * paths need this (start-up timeout and the normal teardown), so it lives in one
 * place rather than being remembered twice.
 */
function stopInspector(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Both failed: say so. A silently held port looks like a hung recorder.
      warn(`could not stop the Inspector (pid ${child.pid}) — check :6274 by hand`);
    }
  }
}

/**
 * Start `@modelcontextprotocol/inspector` pointed at our launcher and resolve
 * the URL it prints — which carries a per-process auth token, so the URL cannot
 * be hardcoded and the token must be read from stdout rather than guessed.
 */
function startInspector(): Promise<{ url: string; child: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", INSPECTOR_PKG, "mcp/bin/devdigest-mcp"], {
      cwd: REPO_ROOT,
      env: { ...process.env, MCP_AUTO_OPEN_ENABLED: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so stopInspector can signal the whole tree.
      detached: true,
    });

    const timer = setTimeout(() => {
      stopInspector(child);
      reject(new Error("the Inspector did not print a URL within 90 s"));
    }, 90_000);

    let buf = "";
    const onChunk = (chunk: Buffer) => {
      buf += chunk.toString();
      const m = buf.match(/http:\/\/localhost:\d+\/?\?MCP_INSPECTOR_API_TOKEN=[a-f0-9]+/);
      if (m) {
        clearTimeout(timer);
        resolve({ url: m[0], child });
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the Inspector exited early (code ${code})\n${buf}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Captions, stills, and the Mantine controls the Inspector is built from
// ---------------------------------------------------------------------------

async function caption(page: Page, step: number, text: string) {
  log(`${step}. ${text}`);
  await page.evaluate(
    ({ id, label }) => {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          position: "fixed",
          left: "0",
          right: "0",
          bottom: "0",
          zIndex: "2147483647",
          padding: "14px 24px",
          font: "600 17px/1.4 ui-sans-serif, -apple-system, Segoe UI, sans-serif",
          color: "#fff",
          background: "linear-gradient(to top, rgba(8,10,14,.96), rgba(8,10,14,.72))",
          borderTop: "1px solid rgba(255,255,255,.14)",
          pointerEvents: "none",
          textAlign: "center",
          letterSpacing: ".01em",
        });
        document.body.appendChild(el);
      }
      el.textContent = label;
    },
    { id: CAPTION_ID, label: `${step}. ${text}` },
  );
}

async function beat(page: Page, step: number, text: string, ms = 3000) {
  await caption(page, step, text);
  await sleep(ms);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
}

/**
 * Mantine hides the real `<input>` of a SegmentedControl and a Switch and drives
 * them from React state, so `.click()` on the visible span does nothing and
 * `.check()` on the hidden input is refused. Clicking the painted element's
 * centre with the mouse is the only thing that moves either of them.
 */
async function clickPainted(page: Page, selector: string, label: string) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 20_000 });
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new Error(`${label}: no bounding box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * The view switcher is a Mantine SegmentedControl, whose label spans Playwright
 * reports as not visible even with the modal closed and the text on screen — so
 * every locator-based click times out. Take the rect from the DOM and click the
 * point: a real mouse event lands on the hidden radio underneath, which is the
 * only thing React listens to.
 */
async function switchView(page: Page, view: "Servers" | "Tools") {
  const point = await page.evaluate((v) => {
    const el = Array.from(document.querySelectorAll('[class*="SegmentedControl-innerLabel"]')).find(
      (e) => (e as HTMLElement).innerText.trim() === v,
    ) as HTMLElement | undefined;
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, view);
  if (!point) throw new Error(`switch to ${view}: no such segmented control`);
  await page.mouse.click(point.x, point.y);
  await sleep(700);
}

/**
 * Read the results panel as a panel.
 *
 * The obvious selector — the first `pre.mantine-Code-root` — works only for a
 * successful call. An error renders as a "Tool Error" block with no code
 * element, so `.first()` then resolves to a *hidden* request frame in the
 * protocol sidebar and the wait times out on a call that actually answered.
 * Anchor on the "Results" heading and take its container's text instead, which
 * is the same for both outcomes.
 */
async function readResults(page: Page): Promise<{ text: string; isError: boolean }> {
  // No named inner function in here: tsx compiles with esbuild's keepNames, which
  // wraps any named function in a `__name(...)` helper that does not exist in the
  // page — the evaluate then dies with "__name is not defined". Inline arrows are
  // fine; `const leaf = (t) => …` is not.
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    const heading = all.find(
      (e) => e.children.length === 0 && (e.textContent ?? "").trim() === "Results",
    );
    if (!heading) return { text: "", isError: false };
    let node: HTMLElement | null = heading as HTMLElement;
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement;
      if (node && node.innerText.trim().length > 40) break;
    }
    if (!node) return { text: "", isError: false };
    // Structure, not substring: the payload itself may contain the words
    // "not implemented" — a repo convention did, and it failed a good call.
    const errorBadge = all.find(
      (e) => e.children.length === 0 && (e.textContent ?? "").trim() === "Tool Error",
    );
    return {
      text: node.innerText.replace(/^Results\s*/, "").trim(),
      isError: Boolean(errorBadge && node.contains(errorBadge)),
    };
  });
}

interface ToolCall {
  tool: string;
  args: Record<string, string>;
  ok: boolean;
  result: string;
}

/**
 * Open a tool, fill what it needs, run it, and return what came back.
 *
 * `expectError` is not a convenience. It exists because a recorder that treats
 * every non-empty result as a pass cannot tell an answer from an error message,
 * and it is still load-bearing in the other direction now that every filmed
 * call is supposed to SUCCEED: a red `get_blast_radius` panel would be filmed,
 * captioned and shipped as evidence unless something asserts otherwise.
 */
async function runTool(
  page: Page,
  toolName: string,
  args: Record<string, string>,
  opts: { expectError?: boolean } = {},
): Promise<ToolCall> {
  await page.locator(`button:has-text("${toolName}")`).first().click();
  await sleep(600);

  for (const [name, value] of Object.entries(args)) {
    const field = page.getByLabel(new RegExp(`^${name}\\b`)).first();
    await field.scrollIntoViewIfNeeded();
    await field.fill(value);
  }

  // Snapshot first: a stale panel from the previous tool would otherwise read
  // as this call's answer the instant Execute is clicked.
  const before = (await readResults(page)).text;

  const execute = page.getByRole("button", { name: "Execute Tool" });
  await execute.scrollIntoViewIfNeeded();
  await execute.click();

  const deadline = Date.now() + 60_000;
  let result = "";
  let isError = false;
  while (Date.now() < deadline) {
    const r = await readResults(page);
    if (r.text.length > 0 && r.text !== before) {
      ({ text: result, isError } = r);
      break;
    }
    await sleep(300);
  }
  if (!result) throw new Error(`${toolName}: no result after 60 s`);
  await sleep(800);

  const ok = opts.expectError ? isError : !isError;
  if (!ok) {
    throw new Error(
      opts.expectError
        ? `${toolName} was expected to fail and did not: ${result.slice(0, 200)}`
        : `${toolName} failed: ${result.slice(0, 200)}`,
    );
  }
  log(`${toolName} → ${result.split("\n")[0].slice(0, 90)}`);
  return { tool: toolName, args, ok: true, result };
}

/** Playwright records WebM; mp4 also plays in QuickTime and Keynote. */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { stdio: "ignore" },
  );
  if (r.status === 0) {
    rmSync(webm, { force: true });
    return mp4;
  }
  warn("no system ffmpeg — leaving the .webm as-is");
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  // Fail before spending 90 s on Chromium if the thing under test cannot answer.
  const health = await fetch(`${API}/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`The API is not answering on ${API} — start it with ../scripts/dev.sh --no-client.`);
  }

  let inspector: ChildProcess | null = null;
  let url = REUSE_URL;
  if (!url) {
    log("starting the MCP Inspector…");
    const started = await startInspector();
    inspector = started.child;
    url = started.url;
  }
  log(`Inspector at ${url.replace(/TOKEN=[a-f0-9]+/, "TOKEN=…")}`);

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  let debugPage: Page | undefined;
  const calls: ToolCall[] = [];

  /**
   * A recorder that dies with only a selector timeout tells you nothing about
   * what was on screen — and the video is discarded with the context, so the
   * evidence dies with it. Leave a still and the two structures every failure
   * here has turned out to involve.
   */
  const dumpFailure = async () => {
    if (!debugPage || debugPage.isClosed()) return;
    try {
      await debugPage.screenshot({ path: join(OUT, "_failure.png") });
      const info = await debugPage.evaluate(() => ({
        segmented: Array.from(document.querySelectorAll('[class*="SegmentedControl-innerLabel"]')).map(
          (e) => (e as HTMLElement).innerText,
        ),
        openDialogs: Array.from(document.querySelectorAll('[role="dialog"]')).length,
        bodyHead: document.body.innerText.slice(0, 400),
      }));
      writeFileSync(join(OUT, "_failure.json"), JSON.stringify(info, null, 2));
      warn(`wrote _failure.png and _failure.json to ${OUT}`);
    } catch {
      /* the page may already be gone */
    }
  };

  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: VIEWPORT },
    });
    const page = await ctx.newPage();
    debugPage = page;

    // NOT networkidle: the Inspector holds a long-lived event stream open, so
    // the network is never idle and the wait can only time out.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByText("Disconnected", { exact: true }).waitFor({ timeout: 30_000 });
    await sleep(1200);

    // 1 — the server, not yet connected
    await beat(page, 1, "One stdio server, spawned by its launcher — no port, no HTTP, no daemon", 4000);
    await shot(page, "server-disconnected");

    // 2 — the handshake
    await clickPainted(page, ".mantine-Switch-track", "connect toggle");
    await page.getByText("Connected", { exact: true }).waitFor({ timeout: 30_000 });
    await sleep(900);
    await beat(page, 2, "Connected over stdio — protocol 2025-11-25, negotiated in one round-trip", 4000);
    await shot(page, "server-connected");

    // 3 — what it actually advertises
    await page.getByText("Connection Info").first().click();
    await page.getByText("Server Implementation").waitFor({ timeout: 10_000 });
    await sleep(900);
    // "no sampling" would be wrong here: sampling is a CLIENT capability, and the
    // right-hand column on this very frame shows the Inspector advertising it.
    await beat(page, 3, "devdigest 0.1.0 — server capabilities: Tools only. No resources, no prompts", 4600);
    await shot(page, "connection-info");
    // While the modal is up the rest of the page is aria-hidden, so every later
    // locator resolves to "not visible" — close it and prove it closed.
    const closeModal = page.locator(".mantine-Modal-close").first();
    if (await closeModal.count()) await closeModal.click();
    else await page.keyboard.press("Escape");
    await page.locator(".mantine-Modal-content").waitFor({ state: "hidden", timeout: 15_000 });
    await sleep(700);

    // 4 — the five tools
    await switchView(page, "Tools");
    await page.getByText("list_agents").first().waitFor({ timeout: 15_000 });
    await beat(page, 4, "Five tools — the whole surface the client ever sees", 4200);
    await shot(page, "tools-list");

    // 5 — a tool is its description, and its annotations
    await page.locator('button:has-text("list_agents")').first().click();
    await sleep(800);
    await beat(page, 5, "READ-ONLY · IDEMPOTENT — the annotations tell a client what it may retry", 4600);
    await shot(page, "tool-annotations");

    // 6 — the first real call
    calls.push(await runTool(page, "list_agents", {}));
    await beat(page, 6, "tools/call over stdio — the sidebar shows the JSON-RPC frame, not a mock", 4600);
    await shot(page, "call-list-agents");

    // 7 — findings for the PR
    calls.push(await runTool(page, "get_findings", { pull_request: `${REPO_NAME}#${PR_NUMBER}` }));
    await beat(page, 7, `get_findings on PR #${PR_NUMBER} — every finding the agents recorded, from one call`, 4800);
    await shot(page, "call-get-findings");

    // 8 — conventions
    calls.push(await runTool(page, "get_conventions", { repo: REPO_NAME }));
    await beat(page, 8, "get_conventions — the house rules, each citing the file it was inferred from", 4600);
    await shot(page, "call-get-conventions");

    // 9 — the impact map, from the code index
    calls.push(await runTool(page, "get_blast_radius", { pull_request: `${REPO_NAME}#${PR_NUMBER}` }));
    await beat(page, 9, "get_blast_radius — changed symbols, their callers by file:line, and the routes downstream", 5200);
    await shot(page, "call-blast-radius");

    // 10 — the one that costs money, opened and left alone
    await page.locator(`button:has-text("${COSTLY_TOOL}")`).first().click();
    await sleep(900);
    await beat(page, 10, "run_agent_on_pull_request spends real money — filmed, deliberately not run", 5000);
    await shot(page, "tool-costly-not-run");

    const summary = {
      recorded_at: new Date().toISOString(),
      inspector: `${INSPECTOR_PKG} (spawned by this recorder)`,
      server: "mcp/bin/devdigest-mcp (stdio)",
      api: API,
      repo: REPO_NAME,
      pull_request: PR_NUMBER,
      executed: calls.map((c) => ({
        tool: c.tool,
        args: c.args,
        first_line: c.result.split("\n")[0].slice(0, 160),
        chars: c.result.length,
      })),
      not_executed: [{ tool: COSTLY_TOOL, why: "calls GitHub and an LLM — spends money" }],
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-mcp-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
  } catch (err) {
    await dumpFailure();
    throw err;
  } finally {
    await ctx?.close();
    await browser?.close();
    if (inspector) stopInspector(inspector);
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});
