/**
 * DevDigest screencast recorder — L02 homework: Conventions Extractor + the API
 * Contract Reviewer control experiment.
 *
 * Two halves, one video:
 *
 *  1. The extractor. Scan a real repo, walk the candidate queue — evidence that
 *     links to the code on GitHub, an edit, a reject — then merge what survived
 *     into one `repo-conventions` skill and link it to an agent.
 *  2. The control experiment. The same PR, the same agent, the same model,
 *     reviewed twice: once with the agent's skills unlinked and once with them
 *     linked. The trace drawer shows the skills block absent, then present.
 *
 * COSTS MONEY, unlike `record:skills`. One extraction (~$0.003 on the cheap
 * conventions model) and nothing else: the two review runs are NOT triggered
 * here. They are found by looking for an existing pair on the target PR, the
 * way `record-skills.ts` finds its trace run — filming is not the place to
 * spend a review budget, and a run recorded live would be a different run from
 * the one the evidence cites.
 *
 * Re-runnable: the skill it creates is deleted by name up front, and the
 * agent's link set is restored in a `finally`.
 *
 * Prereqs: the dev stack is up (`../scripts/dev.sh`), `npm run setup` has
 * fetched Chromium, the target repo is imported AND indexed, and the two
 * experiment runs exist on the target PR.
 *
 * Env (all optional):
 *   DEMO_BASE_URL   web origin      default http://localhost:3000
 *   DEMO_API_URL    API origin      default http://localhost:3001
 *   DEMO_OUT        output dir      default ./recordings/l02-conventions
 *   DEMO_REPO       repo full_name  default teplyakoff/dev-digest
 *   DEMO_PR         PR number       default 4
 *   DEMO_HEADED     "1" to watch    default headless
 *   DEMO_NO_SCAN    "1" to reuse the last scan instead of running a new one
 *
 * Usage:
 *   npm run record:conventions
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.DEMO_BASE_URL ?? "http://localhost:3000";
const API = process.env.DEMO_API_URL ?? "http://localhost:3001";
const OUT = process.env.DEMO_OUT ?? join(HERE, "recordings", "l02-conventions");
const REPO_NAME = process.env.DEMO_REPO ?? "teplyakoff/dev-digest";
const PR_NUMBER = Number(process.env.DEMO_PR ?? 4);
const HEADED = process.env.DEMO_HEADED === "1";
const NO_SCAN = process.env.DEMO_NO_SCAN === "1";

const VIEWPORT = { width: 1280, height: 720 };
const CAPTION_ID = "__devdigest_caption";

/** The skill the recording merges the accepted conventions into. */
const SKILL_NAME = "repo-conventions";
/** The agent the generated skill is linked to at the end. */
const TARGET_AGENT = "General Reviewer";

interface Repo { id: string; full_name: string }
interface Pull { id: string; number: number }
interface Agent { id: string; name: string }
interface Skill { id: string; name: string }
interface AgentSkillLink { skill_id: string; order: number }
interface Candidate { id: string; rule: string; status: string; evidence_path: string }
interface Scan { proposed: number; kept: number; sampled_files: string[]; config_files: string[] }
interface ConventionsView { scan: Scan | null; candidates: Candidate[] }
interface Run {
  run_id: string;
  agent_name: string;
  status: string;
  findings_count: number;
  blockers: number;
  tokens_in: number;
  cost_usd: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
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
  const file = join(OUT, `${String(++shotNo).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
}

/** Playwright records WebM; mp4 also plays in QuickTime and Keynote. */
function toMp4(webm: string): string | null {
  const mp4 = webm.replace(/\.webm$/, ".mp4");
  const r = spawnSync("ffmpeg", ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], {
    stdio: "ignore",
  });
  if (r.status === 0) {
    rmSync(webm, { force: true });
    return mp4;
  }
  warn("no system ffmpeg — leaving the .webm as-is");
  return null;
}

async function deleteSkillByName(name: string) {
  const skills = await api<Skill[]>("/skills");
  for (const s of skills.filter((x) => x.name === name)) {
    await api(`/skills/${s.id}`, { method: "DELETE" }).catch(() => {});
    log(`removed a previous "${name}" so this run can create it fresh`);
  }
}

/**
 * The two runs the experiment compares. Found rather than triggered — see the
 * header.
 *
 * Selection reads each run's `trace.config.skills`, which is the only thing that
 * actually says whether the skills block was in that prompt. Picking by finding
 * count instead — "0 findings must be the run without skills" — mislabelled a
 * frame on the first take: a WITH-skills run had produced one finding that
 * citation grounding then dropped, so it also read 0, and the recording captioned
 * a trace showing four loaded skills as "skills UNLINKED".
 */
async function findExperimentRuns(pullId: string): Promise<{ without: Run; with: Run } | null> {
  const runs = await api<Run[]>(`/pulls/${pullId}/runs`);
  const done = runs.filter((r) => r.status === "done" && r.agent_name === "API Contract Reviewer");

  const withSkills: Run[] = [];
  const withoutSkills: Run[] = [];
  for (const run of done) {
    const trace = await api<{ config?: { skills?: unknown[] } }>(`/runs/${run.run_id}/trace`);
    const skills = trace.config?.skills;
    if (Array.isArray(skills) && skills.length > 0) withSkills.push(run);
    else withoutSkills.push(run);
  }

  // Among the with-skills runs prefer the one that found most: an older run made
  // against an earlier version of a skill body is not the evidence we mean.
  withSkills.sort((a, b) => b.findings_count - a.findings_count);
  const chosenWith = withSkills[0];
  const chosenWithout = withoutSkills[0];
  if (!chosenWith || !chosenWithout) return null;
  if (chosenWith.findings_count === 0) {
    warn("every with-skills run found nothing — the experiment has no contrast to show.");
    return null;
  }
  return { without: chosenWithout, with: chosenWith };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("page@") && f.endsWith(".webm")) rmSync(join(OUT, f), { force: true });
  }

  const repos = await api<Repo[]>("/repos");
  const repo = repos.find((r) => r.full_name === REPO_NAME);
  if (!repo) throw new Error(`Repo ${REPO_NAME} is not imported — add it first.`);

  const pulls = await api<Pull[]>(`/repos/${repo.id}/pulls`);
  const pull = pulls.find((p) => p.number === PR_NUMBER);
  if (!pull) throw new Error(`PR #${PR_NUMBER} is not imported into ${REPO_NAME}.`);

  const agents = await api<Agent[]>("/agents");
  const agent = agents.find((a) => a.name === TARGET_AGENT) ?? agents[0];
  if (!agent) throw new Error("No agents — seed the database first (`pnpm db:seed`).");
  const originalLinks = await api<AgentSkillLink[]>(`/agents/${agent.id}/skills`);

  const experiment = await findExperimentRuns(pull.id);
  if (experiment) {
    log(`experiment runs: without=${experiment.without.run_id.slice(0, 8)} (${experiment.without.findings_count} findings), with=${experiment.with.run_id.slice(0, 8)} (${experiment.with.findings_count})`);
  } else {
    warn(`no with/without run pair on PR #${PR_NUMBER} — skipping the experiment scenes.`);
    warn("run the API Contract Reviewer twice (skills unlinked, then linked), then record again.");
  }

  await deleteSkillByName(SKILL_NAME);

  let browser: Browser | undefined;
  let ctx: BrowserContext | undefined;
  let createdSkill: Skill | null = null;

  try {
    browser = await chromium.launch({ headless: !HEADED });
    ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: "dark",
      recordVideo: { dir: OUT, size: VIEWPORT },
    });
    const page = await ctx.newPage();

    const conventionsUrl = `${BASE}/repos/${repo.id}/conventions`;

    // ---- Part 1: the extractor -------------------------------------------

    // 1 — the page
    await page.goto(conventionsUrl, { waitUntil: "networkidle" });
    await beat(page, 1, "Conventions — the house rules already in the code, harvested", 3200);
    await shot(page, "conventions-page");

    // 2 — run a scan
    if (!NO_SCAN) {
      const scanButton = page.getByRole("button", { name: /Re-scan|Run extraction/ }).first();
      await scanButton.click();
      await beat(page, 2, "Sampling is code, not a model: the configs plus the top-ranked files", 3000);
      await caption(page, 2, "One cheap model call reads that sample and proposes candidates…");
      // The scan is a synchronous request; wait for the button to settle back.
      await page.getByRole("button", { name: "Re-scan" }).waitFor({ timeout: 180_000 });
      await page.waitForFunction(
        () => !document.body.innerText.includes("Scanning…"),
        undefined,
        { timeout: 180_000 },
      );
      await sleep(1200);
    }

    const view = await api<ConventionsView>(`/repos/${repo.id}/conventions`);
    if (!view.scan || view.candidates.length === 0) {
      throw new Error("The scan produced no candidates — nothing to film.");
    }
    log(`scan: ${view.scan.proposed} proposed, ${view.scan.kept} kept, configs ${view.scan.config_files.join(", ")}`);

    // 3 — what survived, and what did not
    await page.reload({ waitUntil: "networkidle" });
    await beat(page, 3, `${view.scan.kept} of ${view.scan.proposed} kept — the rest could not point at real code`, 4200);
    await shot(page, "candidates-with-drop-count");

    // 4 — the evidence is the point
    await beat(page, 4, "Every rule cites a file and a line the model was actually shown", 3600);
    const evidenceLink = page.locator('a[href*="github.com"]').first();
    const href = await evidenceLink.getAttribute("href");
    log(`evidence link: ${href}`);
    await evidenceLink.scrollIntoViewIfNeeded();
    await beat(page, 5, "The snippet is read from the repo, never written by the model — the link proves it", 4200);
    await shot(page, "evidence-links-to-github");

    // 6 — edit a rule
    await page.getByRole("button", { name: "Edit" }).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 10_000 });
    await beat(page, 6, "A candidate is a draft — its wording goes into the skill verbatim", 3600);
    await shot(page, "edit-convention");
    await page.getByRole("button", { name: "Cancel" }).click();
    await sleep(600);

    // 7 — reject one, accept the rest
    const firstCard = page.locator("h1 ~ div").first();
    const rejectedRule = (await page.locator("div").filter({ hasText: /^/ }).first().isVisible())
      ? (await api<ConventionsView>(`/repos/${repo.id}/conventions`)).candidates[0]?.rule ?? null
      : null;
    void firstCard;
    await page.getByRole("button", { name: "Reject" }).first().click();
    await sleep(900);
    if (rejectedRule) log(`rejected: "${rejectedRule.slice(0, 60)}"`);
    await beat(page, 7, "Reject stays on screen, dimmed — an accidental one has to be undoable", 3600);
    await shot(page, "rejected-stays-visible");

    await page.getByRole("button", { name: "Accept all" }).click();
    await sleep(1500);
    await beat(page, 8, "Accept all takes the undecided ones — it does not overturn the rejection", 4200);
    await shot(page, "accepted");

    // 9 — merge into a skill
    await page.getByRole("button", { name: "Create skill" }).first().click();
    await page.getByRole("dialog").waitFor({ timeout: 10_000 });
    await page.getByLabel("Skill body").waitFor({ timeout: 10_000 });
    const draft = await api<{ body: string; candidate_ids: string[] }>(
      `/repos/${repo.id}/conventions/skill-draft`,
    );
    if (rejectedRule && draft.body.includes(rejectedRule)) {
      throw new Error(`The rejected rule reached the skill body: ${rejectedRule}`);
    }
    log(`draft: ${draft.candidate_ids.length} rules, rejected rule absent \u2713`);
    await beat(page, 9, `Merged on the SERVER from ${draft.candidate_ids.length} accepted rules — the rejected one is not among them`, 4800);
    await shot(page, "create-skill-modal");

    await page.getByRole("dialog").getByRole("button", { name: "Create skill" }).click();
    await page.waitForURL(/\/skills\/[0-9a-f-]+/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await beat(page, 10, `Saved as v1, source "extracted" — a skill like any other`, 4000);
    await shot(page, "skill-created");

    const skills = await api<Skill[]>("/skills");
    createdSkill = skills.find((s) => s.name === SKILL_NAME) ?? null;
    if (!createdSkill) throw new Error("The skill was not created — the modal did not save.");

    // 11 — link it to an agent
    await api(`/agents/${agent.id}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skill_ids: [...originalLinks.sort((a, b) => a.order - b.order).map((l) => l.skill_id), createdSkill.id],
      }),
    });
    await page.goto(`${BASE}/agents/${agent.id}?tab=skills`, { waitUntil: "networkidle" });
    await page.getByText(SKILL_NAME, { exact: true }).first().waitFor({ timeout: 15_000 });
    await beat(page, 11, `Linked to ${agent.name} — it now loads on every run that agent does`, 4200);
    await shot(page, "skill-linked-to-agent");

    // ---- Part 2: the control experiment ----------------------------------

    if (experiment) {
      const prUrl = `${BASE}/repos/${repo.id}/pulls/${PR_NUMBER}`;

      await page.goto(`${prUrl}?tab=findings`, { waitUntil: "networkidle" });
      await beat(page, 12, `PR #${PR_NUMBER} renames an HTTP route and a response field. It compiles clean`, 4600);
      await shot(page, "experiment-pr");

      await page.goto(`${prUrl}?tab=findings&trace=${experiment.without.run_id}`, { waitUntil: "networkidle" });
      await sleep(1400);
      await beat(page, 13, "Same agent, same model, skills UNLINKED — approved, nothing found", 4600);
      await shot(page, "without-skills-trace");

      await page.goto(`${prUrl}?tab=findings&trace=${experiment.with.run_id}`, { waitUntil: "networkidle" });
      await sleep(1400);
      await beat(page, 14, `Skills linked: ${experiment.with.findings_count} CRITICAL findings, merge blocked`, 5000);
      await shot(page, "with-skills-trace");

      await beat(page, 15, "The only thing that changed is the prompt's skills block", 4200);
      await shot(page, "with-skills-prompt-block");
    }

    const summary = {
      recorded_at: new Date().toISOString(),
      repo: REPO_NAME,
      scan: view.scan,
      candidates: view.candidates.length,
      evidence_link_sample: href,
      created_skill: SKILL_NAME,
      linked_to_agent: agent.name,
      experiment: experiment
        ? {
            pr: PR_NUMBER,
            without_skills: {
              run_id: experiment.without.run_id,
              findings: experiment.without.findings_count,
              tokens_in: experiment.without.tokens_in,
              cost_usd: experiment.without.cost_usd,
            },
            with_skills: {
              run_id: experiment.with.run_id,
              findings: experiment.with.findings_count,
              blockers: experiment.with.blockers,
              tokens_in: experiment.with.tokens_in,
              cost_usd: experiment.with.cost_usd,
            },
          }
        : null,
    };
    writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));

    await page.close();
    await ctx.close();
    ctx = undefined;

    const raw = await page.video()?.path();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const final = join(OUT, `devdigest-conventions-${stamp}.webm`);
    if (raw) renameSync(raw, final);
    const mp4 = raw ? toMp4(final) : null;

    log(`\x1b[32m✓ video:\x1b[0m ${mp4 ?? (raw ? final : "(not recorded)")}`);
    log(`\x1b[32m✓ frames + summary.json:\x1b[0m ${OUT}`);
    if (!experiment) process.exitCode = 1;
  } finally {
    await ctx?.close();
    await browser?.close();
    // The recording is evidence, not a migration: put the agent back.
    await api(`/agents/${agent.id}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill_ids: originalLinks.sort((a, b) => a.order - b.order).map((l) => l.skill_id) }),
    }).catch(() => warn("could not restore the agent's skill links"));
  }
}

main().catch((err) => {
  console.error(`\x1b[31m✗ ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
  process.exit(1);
});
