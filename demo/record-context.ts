/**
 * DevDigest screencast recorder — L05 lab: Project Context.
 *
 * Five parts, one video:
 *
 *  1. The page. A new **Project Context** entry in the sidebar's Workspace
 *     section, and behind it every `.md` file in the repo offered for import —
 *     194 of them on this repo, read out of the clone, not typed by anyone.
 *  2. The document. Three are imported; clicking one shows its text in the
 *     panel beside the list.
 *  3. The counter, and the point of the whole feature: each row says how many
 *     agents would receive that document. It starts at none, becomes one when
 *     the document is attached to an agent, and two on the second — live, with
 *     no reload. Every step is ASSERTED, not just filmed.
 *  4. The sum. Two more documents go onto a SKILL that an agent links, so that
 *     agent now carries three: one of its own and two the skill brings. The
 *     count on those rows moves without anyone touching the agent.
 *  5. The proof. That agent runs on a real PR, and the run says
 *     `Project context: 3/3 document(s) loaded` in its log while Prompt
 *     Assembly shows the three documents by name with what each one cost.
 *
 * COSTS MONEY: one real review run (`POST /pulls/:id/review`) with one agent.
 * Everything before part 5 is free — the store makes no model call at all.
 *
 * WHAT IT ASSERTS rather than films: the counter's three values (0 → 1 → 2),
 * that attaching to a skill moves the count of a document nobody touched
 * directly, and that the run's own log line reports exactly three documents.
 * A regression in any of them still records a video that looks convincing,
 * which is why they are checks.
 *
 * IT CLEANS UP AFTER ITSELF. The documents it imports and every attachment it
 * makes are removed in `finally`, including after a failure — a second take
 * would otherwise start with the counters already at 1 and film nothing.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, the repo is cloned (the candidate list comes from the
 * clone), and the target agent links at least one ENABLED skill — the sum in
 * part 4 has nowhere to come from otherwise. The preflight checks both and
 * refuses to launch the browser rather than filming an empty claim.
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin       default http://localhost:3000
 *   DEMO_API_URL    API origin       default http://localhost:3001
 *   DEMO_OUT        output dir       default ./recordings/l05-context
 *   DEMO_REPO       repo full_name   default teplyakoff/dev-digest
 *   DEMO_PR         PR number        default 4       (small on purpose)
 *   DEMO_AGENT      agent name       default Security Reviewer
 *   DEMO_AGENT_2    second agent     default General Reviewer
 *   DEMO_HEADED     "1" to watch     default headless
 *   DEMO_RUN_TIMEOUT ms per review   default 900000
 *
 * Usage:
 *   npm run record:context
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l05-context");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 4);
const AGENT_1 = process.env.DEMO_AGENT ?? "Security Reviewer";
const AGENT_2 = process.env.DEMO_AGENT_2 ?? "General Reviewer";
const HEADED = process.env.DEMO_HEADED === "1";
const RUN_TIMEOUT = Number(process.env.DEMO_RUN_TIMEOUT ?? 900_000);

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";

/**
 * Small on purpose — the video shows the list, not a wall of prose — and with
 * DISTINCT BASENAMES, because an import is named by the file's basename and a
 * repo may hold only one document per name. Three `README.md`s from three
 * directories look like three documents in the picker and collide on the second
 * import.
 */
const WANTED = [
  "e2e/docs/specs/README.md",
  "server/src/modules/repo-intel/AGENTS.md",
  "e2e/INSIGHTS.md",
];

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number; title: string }
interface Agent { id: string; name: string; enabled: boolean }
interface Skill { id: string; name: string; enabled: boolean }
interface AgentSkill { agent_id: string; skill_id: string; order: number }
interface Candidate { path: string; bytes: number; status: string }
/** The picker's payload: a list plus whether the walk stopped early. */
interface Candidates { candidates: Candidate[]; truncated: boolean }
interface Doc { id: string; name: string; bytes: number; tokens: number; agents: number }
interface RunSummary { run_id: string; agent_name: string | null; status: string | null }

const TERMINAL = new Set(["done", "failed", "cancelled"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function log(msg: string) {
  console.log(`\x1b[36m•\x1b[0m ${msg}`);
}
function warn(msg: string) {
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
}

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

async function beat(page: Page, step: number, text: string, ms = 2800) {
  await caption(page, step, text);
  await sleep(ms);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
}

/** Playwright records WebM; mp4 also plays in QuickTime and Keynote. */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-i", webm, "-c:v", "libx264", "-crf", "28", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
    { stdio: "ignore" },
  );
  if (r.status === 0) {
    rmSync(webm, { force: true });
    return mp4;
  }
  warn("no system ffmpeg — leaving the .webm as-is");
  return null;
}

/**
 * Put the document's ROW back in frame before a counter shot.
 *
 * Attaching happens in the "Attach to" panel BELOW the list, and clicking there
 * scrolls the list off the top of the viewport — so the first take of this
 * recording captioned three stills "the row says one agent" over a screen where
 * no row was visible at all. The assertion passed; the frame proved nothing.
 */
async function showRow(page: Page, name: string) {
  const row = page.getByRole("listitem", { name }).first();
  await row.scrollIntoViewIfNeeded();
  await sleep(600);
}

/** The count the page shows for one document, read from the API it renders. */
async function reachOf(repoId: string, docId: string): Promise<number> {
  const docs = await api<Doc[]>(`/repos/${repoId}/context/docs`);
  const doc = docs.find((d) => d.id === docId);
  if (!doc) throw new Error(`Document ${docId} vanished from the store mid-take.`);
  return doc.agents;
}

/**
 * Assert a counter value, naming what it was supposed to prove.
 *
 * The message matters more than the check: "expected 2, got 1" from a video
 * recorder is unreadable a week later, and this is the one number the whole
 * lab is about.
 */
function assertReach(actual: number, expected: number, claim: string): void {
  if (actual !== expected) {
    throw new Error(`${claim} — expected the document to reach ${expected} agent(s), the API says ${actual}.`);
  }
  log(`counter ✓ ${claim} → ${actual}`);
}

async function waitForRun(prId: string, runId: string): Promise<RunSummary> {
  const deadline = Date.now() + RUN_TIMEOUT;
  for (;;) {
    const runs = await api<RunSummary[]>(`/pulls/${prId}/runs`);
    const run = runs.find((r) => r.run_id === runId);
    if (run && TERMINAL.has(run.status ?? "")) return run;
    if (Date.now() > deadline) {
      await api(`/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
      throw new Error(`The review did not settle within ${RUN_TIMEOUT}ms (cancelled).`);
    }
    await sleep(2000);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // ---- preflight ----------------------------------------------------------

  const repos = await api<Repo[]>("/repos");
  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — import it first.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} not found in ${REPO_NAME}.`);

  const agents = await api<Agent[]>("/agents");
  const agent1 = agents.find((a) => a.name === AGENT_1);
  const agent2 = agents.find((a) => a.name === AGENT_2);
  if (!agent1 || !agent2) throw new Error(`Agents "${AGENT_1}" and "${AGENT_2}" must both exist.`);

  // The sum in part 4 needs a skill that is BOTH linked to the agent and
  // enabled — `specsForAgent` filters on the flag, so a disabled skill would
  // carry documents nobody ever sees and the count would refuse to move.
  const links = await api<AgentSkill[]>(`/agents/${agent1.id}/skills`);
  const skills = await api<Skill[]>("/skills");
  const skill = skills.find((s) => s.enabled && links.some((l) => l.skill_id === s.id));
  if (!skill) {
    throw new Error(
      `"${agent1.name}" links no ENABLED skill, so the "one on the agent, two on its skill" sum has nowhere to come from. ` +
        "Link one on the Agents page, or point DEMO_AGENT at an agent that has one.",
    );
  }

  const { candidates } = await api<Candidates>(`/repos/${repo.id}/context/candidates`);
  if (candidates.length === 0) {
    throw new Error("The repo offers no .md candidates — is it cloned? The list is read from the clone.");
  }
  const picks = WANTED.map((p) => candidates.find((c) => c.path === p)).filter((c): c is Candidate => !!c);
  if (picks.length < 3) {
    throw new Error(`Expected ${WANTED.length} known small documents in the candidate list, found ${picks.length}.`);
  }

  // A name already in the store would 409 the import halfway through the take,
  // after the browser is up and the first scenes are already on tape.
  const existing = await api<Doc[]>(`/repos/${repo.id}/context/docs`);
  const wantedNames = picks.map((c) => c.path.split("/").pop()!);
  const clash = existing.find((d) => wantedNames.includes(d.name));
  if (clash) {
    throw new Error(
      `The store already holds a document named "${clash.name}", and an import is named by its basename. ` +
        "Delete it, or point WANTED at other files.",
    );
  }

  // WHAT WAS ATTACHED BEFORE THIS TAKE, so `finally` can put it back.
  //
  // The attachment API is a REPLACE: sending `[]` detaches everything, not just
  // what this script attached. Clearing it blind would delete a configuration
  // the recording did not create — `record-skills.ts` learned the same lesson
  // about an agent's skill links and says it plainly: the recording is
  // evidence, not a migration.
  const priorAgentDocs = new Map<string, string[]>();
  for (const agent of [agent1, agent2]) {
    const attached = await api<{ id: string; missing?: boolean }[]>(`/agents/${agent.id}/context-docs`);
    priorAgentDocs.set(agent.id, attached.map((d) => d.id));
  }
  const priorSkillDocs = (
    await api<{ id: string }[]>(`/skills/${skill.id}/context-docs`)
  ).map((d) => d.id);
  const priorCount = [...priorAgentDocs.values()].flat().length + priorSkillDocs.length;
  if (priorCount > 0) {
    log(`noted ${priorCount} pre-existing attachment(s) to restore afterwards`);
  }

  log(`preflight ✓ ${candidates.length} candidate(s), agent "${agent1.name}" → enabled skill "${skill.name}"`);

  const created: string[] = [];
  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;

  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: VIEWPORT },
      colorScheme: "dark",
    });
    const page = await ctx.newPage();
    const contextUrl = `${BASE}/repos/${repo.id}/context`;

    // ---- Part 1: the page ---------------------------------------------------

    await page.goto(`${BASE}/repos/${repo.id}/pulls`, { waitUntil: "networkidle" });
    await sleep(1200);
    await beat(page, 1, "A new entry in the sidebar's Workspace section: Project Context", 3200);
    await shot(page, "sidebar");

    await page.getByRole("link", { name: "Project Context" }).click();
    await page.waitForURL(/\/context$/, { timeout: 15_000 });
    await sleep(1400);
    await beat(page, 2, "The documents this repo's agents can be given to read", 3000);

    await page.getByRole("button", { name: "Import from repo" }).click();
    await sleep(1600);
    await beat(page, 3, `Every .md file in the repo, read out of the clone — ${candidates.length} of them`, 4200);
    await shot(page, "import-candidates");
    await page.keyboard.press("Escape");
    await sleep(800);

    // Imported through the API rather than by clicking three rows in a modal:
    // the picker is already on camera, and what parts 3-5 are about is what
    // happens AFTER the documents exist.
    for (const c of picks) {
      const doc = await api<Doc>(`/repos/${repo.id}/context/docs`, {
        method: "POST",
        body: JSON.stringify({ kind: "import", path: c.path }),
      });
      created.push(doc.id);
    }
    const docs = await api<Doc[]>(`/repos/${repo.id}/context/docs`);
    const mine = created.map((id) => docs.find((d) => d.id === id)!);
    log(`imported ${mine.map((d) => d.name).join(", ")}`);

    // ---- Part 2: the document ----------------------------------------------

    await page.goto(contextUrl, { waitUntil: "networkidle" });
    await sleep(1400);
    await page.getByRole("listitem", { name: mine[0]!.name }).click();
    await sleep(1200);
    await beat(page, 4, "Click a document — its text is right there, beside the list", 4200);
    await shot(page, "doc-body");

    // ---- Part 3: the counter -----------------------------------------------

    const target = mine[0]!;
    assertReach(await reachOf(repo.id, target.id), 0, "a freshly imported document reaches nobody");
    await showRow(page, target.name);
    await beat(page, 5, "Every row says how many agents would receive it. This one: none yet", 3600);
    await shot(page, "count-zero");

    const attachTo = async (agent: Agent, docIds: string[]) => {
      await api(`/agents/${agent.id}/context-docs`, {
        method: "PUT",
        body: JSON.stringify({ doc_ids: docIds }),
      });
    };

    // Attaching through the page, not the API: "the number moves without a
    // reload" is the claim, and an API call plus a refresh would not make it.
    const agentsTab = page.getByRole("tab", { name: "Agents" });
    await agentsTab.click();
    await sleep(700);
    const attachBtn = (name: string) =>
      page
        .locator("div")
        .filter({ hasText: new RegExp(`^${name}`) })
        .getByRole("button", { name: `Attach ${target.name}` })
        .first();

    await attachBtn(agent1.name).click();
    await page.getByText("1 agent", { exact: true }).waitFor({ timeout: 10_000 });
    assertReach(await reachOf(repo.id, target.id), 1, `attached to ${agent1.name}`);
    await showRow(page, target.name);
    await beat(page, 6, `Attached to ${agent1.name} — the row says one agent, with no reload`, 4200);
    await shot(page, "count-one");

    await attachBtn(agent2.name).click();
    await page.getByText("2 agents", { exact: true }).waitFor({ timeout: 10_000 });
    assertReach(await reachOf(repo.id, target.id), 2, `attached to ${agent2.name} as well`);
    await showRow(page, target.name);
    await beat(page, 7, `And to ${agent2.name} — two`, 4200);
    await shot(page, "count-two");

    // Part 5 needs exactly one document on the agent itself.
    await attachTo(agent2, []);
    await attachTo(agent1, [target.id]);

    // ---- Part 4: the sum ----------------------------------------------------

    const viaSkill = [mine[1]!, mine[2]!];
    await api(`/skills/${skill.id}/context-docs`, {
      method: "PUT",
      body: JSON.stringify({ doc_ids: viaSkill.map((d) => d.id) }),
    });

    await page.goto(contextUrl, { waitUntil: "networkidle" });
    await sleep(1600);
    for (const d of viaSkill) {
      const reach = await reachOf(repo.id, d.id);
      if (reach < 1) {
        throw new Error(
          `${d.name} is on skill "${skill.name}", which ${agent1.name} links — its count should not be zero.`,
        );
      }
    }
    log(`sum ✓ two documents on "${skill.name}" reach ${agent1.name} without being attached to it`);
    await showRow(page, viaSkill[0]!.name);
    await beat(page, 8, `Two more go onto the skill "${skill.name}" — their rows count agents too`, 4600);
    await shot(page, "count-via-skill");

    // ---- Part 5: the proof --------------------------------------------------

    const prUrl = `${BASE}/repos/${repo.id}/pulls/${pull.number}`;
    await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
    await sleep(1200);
    await beat(page, 9, `${agent1.name} now carries three documents: one of its own, two from its skill`, 4000);

    await page.getByRole("button", { name: /Run Review/i }).click();
    const runAll = page.getByRole("button", { name: "Run all enabled agents" });
    await runAll.waitFor({ timeout: 10_000 });
    const menu = runAll.locator("xpath=..");
    const started = page.waitForResponse(
      (r) => r.url().includes("/review") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    // Prefix match: a dropdown item renders its model hint inside the same
    // button, so the accessible name is "Security Reviewer deepseek/…".
    await menu
      .getByRole("button", { name: new RegExp(`^${agent1.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })
      .click();
    const res = await started;
    const runId = ((await res.json()) as { runs: { run_id: string }[] }).runs[0]!.run_id;

    const line = page.getByText(/Project context: \d+\/\d+ document/).first();
    await line.waitFor({ timeout: 180_000 });
    await line.scrollIntoViewIfNeeded();
    const logText = (await line.textContent()) ?? "";
    const match = /Project context: (\d+)\/(\d+) document/.exec(logText);
    if (!match) throw new Error(`The log line did not parse: ${logText}`);
    if (match[1] !== "3" || match[2] !== "3") {
      throw new Error(
        `The run reports ${match[1]}/${match[2]} documents; the agent has one of its own and two on its skill, so it must be 3/3.`,
      );
    }
    log(`run log ✓ ${logText.trim()}`);
    await sleep(800);
    await beat(page, 10, "The run says it out loud: three documents loaded — one direct, two from the skill", 5200);
    await shot(page, "run-log-context");

    const run = await waitForRun(pull.id, runId);
    if (run.status !== "done") warn(`the run settled as ${run.status} — the trace scenes may be thin`);

    await page.goto(`${prUrl}?tab=findings&trace=${runId}`, { waitUntil: "networkidle" });
    await page.getByText("Prompt assembly", { exact: true }).first().click();
    await sleep(1000);
    const specs = page.getByText(mine[0]!.name, { exact: false }).first();
    await specs.waitFor({ timeout: 20_000 });
    await specs.scrollIntoViewIfNeeded();
    await sleep(700);
    await beat(page, 11, "Prompt assembly: the documents that went into the prompt, by name and by cost", 5200);
    await shot(page, "prompt-assembly");

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: repo.full_name,
      pr: pull.number,
      candidates: candidates.length,
      documents: mine.map((d) => ({ id: d.id, name: d.name, bytes: d.bytes, tokens: d.tokens })),
      agent: agent1.name,
      second_agent: agent2.name,
      skill: skill.name,
      asserted: {
        counter_zero: 0,
        counter_after_first_attach: 1,
        counter_after_second_attach: 2,
        skill_documents_reach_the_agent: true,
        run_log: logText.trim(),
      },
      run: { run_id: runId, status: run.status },
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-context-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
  } finally {
    await ctx?.close();
    await browser?.close();

    // Cleanup runs even after a failure. A take that left its documents behind
    // would make the next one start at "1 agent" and film nothing.
    //
    // RESTORE, never clear: the sets go back to exactly what the preflight
    // read, so an installation that already had documents attached keeps them.
    // The documents this take created are deleted below, and deleting a
    // document takes its attachment rows with it, so the restored ids are only
    // ever the pre-existing ones.
    for (const agent of [agent1, agent2]) {
      await api(`/agents/${agent.id}/context-docs`, {
        method: "PUT",
        body: JSON.stringify({ doc_ids: priorAgentDocs.get(agent.id) ?? [] }),
      }).catch(() => warn(`could not restore ${agent.name}'s attachments`));
    }
    await api(`/skills/${skill.id}/context-docs`, {
      method: "PUT",
      body: JSON.stringify({ doc_ids: priorSkillDocs }),
    }).catch(() => warn(`could not restore skill "${skill.name}"'s attachments`));
    for (const id of created) {
      await api(`/repos/${repo.id}/context/docs/${id}`, { method: "DELETE" }).catch(() => {});
    }
    if (created.length) log(`cleaned up ${created.length} document(s) and every attachment this take made`);
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});
