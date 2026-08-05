/* SkillsTab — attach, detach and order the skills this agent loads.
   Order is the order the blocks appear in the assembled prompt. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills, useSkills } from "../../../../../../../lib/hooks/skills";
import { TYPE_COLOR } from "../../../../../../skills/_components/SkillCard/constants";
import { filterRows, moveId, orderRows, toggleLink } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills(agent.id);
  const [filter, setFilter] = React.useState("");
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const rows = orderRows(skills ?? [], links ?? []);
  const visible = filterRows(rows, filter);
  const linkedIds = rows.filter((r) => r.linked).map((r) => r.skill.id);

  if (isLoading) return <Skeleton height={180} />;
  if (isError) return <ErrorState body={ts("page.loadError")} onRetry={() => refetch()} />;
  if ((skills ?? []).length === 0) {
    return (
      <EmptyState
        icon="Sparkles"
        title={ts("page.empty.title")}
        body={ts("page.empty.body")}
        cta={ts("page.empty.cta")}
        onCta={() => router.push("/skills")}
      />
    );
  }

  const onDrop = (targetId: string) => {
    if (dragIndex === null) return;
    const to = linkedIds.indexOf(targetId);
    if (to !== -1) setSkills.mutate(moveId(linkedIds, dragIndex, to));
    setDragIndex(null);
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedIds.length, total: (skills ?? []).length })}
        </Badge>
        <div style={s.filter}>
          <Icon.Search size={13} style={s.searchIcon} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.filterInput}
          />
        </div>
      </div>

      <p style={s.hint}>{t("skills.orderHint")}</p>

      <div style={s.list}>
        {visible.map((row) => {
          const color = TYPE_COLOR[row.skill.type];
          const index = linkedIds.indexOf(row.skill.id);
          return (
            <div
              key={row.skill.id}
              style={s.row(row.linked, dragIndex === index && index !== -1)}
              draggable={row.linked}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => row.linked && e.preventDefault()}
              onDrop={() => onDrop(row.skill.id)}
              onDragEnd={() => setDragIndex(null)}
            >
              <span style={s.grip(row.linked)}>
                <Icon.Menu size={14} />
              </span>
              <button
                type="button"
                role="checkbox"
                aria-checked={row.linked}
                aria-label={row.skill.name}
                onClick={() => setSkills.mutate(toggleLink(linkedIds, row.skill.id))}
                style={s.checkbox(row.linked)}
              >
                {row.linked && <Icon.Check size={11} style={s.checkGlyph} />}
              </button>
              <button
                type="button"
                className="mono"
                style={s.name}
                onClick={() => router.push(`/skills/${row.skill.id}?tab=config`)}
              >
                {row.skill.name}
              </button>
              {/* A globally disabled skill stays listed and linkable — hiding it
                  would make "why is my skill not in the prompt?" unanswerable
                  from the screen where you'd ask it. */}
              {!row.skill.enabled && (
                <span style={s.disabledNote}>{t("skills.disabledGlobally")}</span>
              )}
              <span style={s.typePill(color)}>{ts(`listItem.type.${row.skill.type}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
