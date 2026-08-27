/**
 * Labeled test groups. Wrapping vitest's `describe` gives every case a tier prefix in the
 * output (skill: / agent: / workflow:), which is both readable and how the statistics layer
 * groups series by tier.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe } from "vitest";

import { AGENTS_DIR } from "../artifacts/paths.js";

export const describeSkill = (name: string, fn: () => void) => describe(`skill:${name}`, fn);

/**
 * An eval suite may name an agent that does not exist on disk — a planned A/B variant whose
 * artifact was never written (architecture-reviewer-lite is the known case). That is a gap in
 * the harness, not a regression in an agent, so it SKIPS with a visible reason instead of
 * failing every case with `agent not found` from agentContent(). The suite starts running by
 * itself the moment someone adds the .md; nothing needs re-wiring.
 */
export const describeAgent = (name: string, fn: () => void) => {
  const artifact = join(AGENTS_DIR, `${name}.md`);
  if (!existsSync(artifact)) {
    return describe.skip(`agent:${name} (SKIP — no .claude/agents/${name}.md)`, fn);
  }
  return describe(`agent:${name}`, fn);
};

export const describeWorkflow = (name: string, fn: () => void) => describe(`workflow:${name}`, fn);
