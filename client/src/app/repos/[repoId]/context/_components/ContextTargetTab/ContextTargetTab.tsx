"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { AttachedDoc, ContextDoc } from "@/lib/types";
import { useAgents } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import {
  useAgentContextDocs,
  useSetAgentContextDocs,
  useSetSkillContextDocs,
  useSkillContextDocs,
} from "@/lib/hooks/context";
import { attachedTokens, toggleAttachment } from "../../helpers";
import { WARN_CONTEXT_TOKENS } from "../../constants";
import { s } from "./styles";

type Kind = "agents" | "skills";

/**
 * Which documents each agent, and each skill, carries into a review.
 *
 * Every write sends the target's WHOLE id set in one request. A delta would
 * leave the server's replace semantics correct and the result wrong — the ids
 * left out are detached by their absence, which is the contract.
 */
export function ContextTargetTab({ docs }: { docs: ContextDoc[] }) {
  const t = useTranslations("context");
  const [kind, setKind] = React.useState<Kind>("agents");
  const agents = useAgents();
  const skills = useSkills();

  const targets =
    kind === "agents"
      ? (agents.data ?? []).map((a) => ({ id: a.id, name: a.name, usedBy: null as number | null }))
      : (skills.data ?? []).map((sk) => ({
          id: sk.id,
          name: sk.name,
          // AC-28 reads the ONE aggregate that already exists — `Skill.used_by`
          // on `GET /skills`. A second count computed here would be a second
          // source of truth for one sentence, and they would disagree the first
          // time one was invalidated and the other was not.
          usedBy: sk.used_by ?? null,
        }));

  return (
    <div style={s.panel}>
      <div style={s.tabs} role="tablist">
        {(["agents", "skills"] as const).map((k) => (
          <Button
            key={k}
            size="sm"
            role="tab"
            aria-selected={kind === k}
            active={kind === k}
            onClick={() => setKind(k)}
          >
            {t(`targets.${k}`)}
          </Button>
        ))}
      </div>

      <div style={s.targets}>
        {targets.map((target) => (
          <TargetRow key={target.id} kind={kind} target={target} docs={docs} />
        ))}
      </div>
    </div>
  );
}

function TargetRow({
  kind,
  target,
  docs,
}: {
  kind: Kind;
  target: { id: string; name: string; usedBy: number | null };
  docs: ContextDoc[];
}) {
  const t = useTranslations("context");
  const agentDocs = useAgentContextDocs(kind === "agents" ? target.id : null);
  const skillDocs = useSkillContextDocs(kind === "skills" ? target.id : null);
  const setAgentDocs = useSetAgentContextDocs(target.id);
  const setSkillDocs = useSetSkillContextDocs(target.id);

  const attached: AttachedDoc[] = (kind === "agents" ? agentDocs.data : skillDocs.data) ?? [];
  const attachedIds = attached.map((d) => d.id);
  const tokens = attachedTokens(attached);

  const save = (next: string[]) => {
    if (kind === "agents") setAgentDocs.mutate(next);
    else setSkillDocs.mutate(next);
  };

  // A document that has left the store but is still attached. Kept in the list
  // rather than filtered out, so it can be detached from here.
  const missing = attached.filter((d) => d.missing);
  const rows = [...docs.map((d) => ({ ...d, missing: false })), ...missing];

  return (
    // A real accessible container, not a bare <div>. It gives each target an
    // addressable name, so a test can scope to one row with
    // `getByRole('group', { name })` instead of walking the DOM with
    // `closest('div')` — a query that keeps passing after a styling wrapper
    // silently rescopes it to the wrong element.
    <div role="group" aria-label={target.name} style={s.target}>
      <div style={s.targetHead}>
        <span style={s.targetName}>{target.name}</span>
        {target.usedBy !== null && (
          <span style={s.empty}>{t("targets.usedBy", { count: target.usedBy })}</span>
        )}
        <span style={s.targetMeta}>{t("targets.tokens", { count: tokens })}</span>
      </div>

      {/* Warns, never blocks. A person who deliberately attached a large
          specification is not making a mistake the page should refuse. */}
      {tokens > WARN_CONTEXT_TOKENS && (
        <div role="status" style={s.warn}>
          {t("targets.warn", { count: tokens })}
        </div>
      )}

      <div style={s.docs}>
        {rows.length === 0 && <span style={s.empty}>{t("empty.title")}</span>}
        {rows.map((doc) => {
          const isAttached = attachedIds.includes(doc.id);
          return (
            <button
              key={doc.id}
              type="button"
              // The accessible name INCLUDES the document's name, so a screen
              // reader hears which document is being attached rather than
              // "toggle". `aria-pressed` carries the state; the colour only
              // follows it.
              aria-label={t(isAttached ? "targets.detach" : "targets.attach", {
                name: doc.missing ? `${doc.name} — ${t("targets.missing")}` : doc.name,
              })}
              aria-pressed={isAttached}
              style={s.doc(isAttached, doc.missing)}
              onClick={() => save(toggleAttachment(attachedIds, doc.id))}
            >
              {doc.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
