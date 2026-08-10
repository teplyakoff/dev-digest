/* Stats tab — what this skill is attached to, and what it has actually cost.
   Every number comes from a persisted run trace; the design's pull-frequency
   and accept-rate tiles are deliberately absent, because no table links a
   finding back to the skill that provoked it. See the SkillStats contract. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, MonoLink, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../lib/hooks/skills";
import { s } from "../styles";

function Stat({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div style={s.statTile}>
      <div style={s.statLabel}>{label}</div>
      <div style={s.statValue}>
        {value}
        {suffix && <span style={s.statSuffix}>{suffix}</span>}
      </div>
    </div>
  );
}

export function SkillStatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) return <Skeleton height={200} />;
  if (isError || !data) return <ErrorState body={t("stats.loadError")} onRetry={() => refetch()} />;

  // Nothing links to it and nothing has run it: there is no story to tell yet,
  // so say what to do instead of rendering four zeroes.
  if (data.agents.length === 0 && data.runs === 0) {
    return <EmptyState icon="BarChart" title={t("stats.empty.title")} body={t("stats.empty.body")} />;
  }

  return (
    <div style={s.statsWrap}>
      <h2 style={s.h2}>{t("stats.title")}</h2>
      <p style={s.statsSubtitle}>{t("stats.subtitle")}</p>

      <div style={s.statGrid}>
        <Stat label={t("stats.usedBy")} value={String(data.agents.length)} />
        <Stat label={t("stats.runs")} value={String(data.runs)} />
        {/* Pin the locale, as every other token count does (SkillConfigTab,
            SkillPreviewDrawer, TraceBody). A bare toLocaleString() follows the
            machine's locale, so this tab rendered "1 336" while the Config tab
            of the same editor showed "1,336". */}
        <Stat label={t("stats.tokensTotal")} value={data.tokens_total.toLocaleString("en-US")} />
        <Stat
          label={t("stats.tokensAvg")}
          value={data.tokens_avg.toLocaleString("en-US")}
          suffix={t("stats.perRun")}
        />
      </div>

      <SectionLabel icon="Cpu">{t("stats.agentsTitle")}</SectionLabel>
      {data.agents.length === 0 ? (
        // Runs but no agents: the links were removed after those runs happened.
        // The cost is still real, so keep the tiles and explain the gap.
        <p style={s.statsSubtitle}>{t("stats.noAgents")}</p>
      ) : (
        <div style={s.agentList}>
          {data.agents.map((a) => (
            <div key={a.agent_id} style={s.agentRow}>
              <div style={s.agentIcon}>
                <Icon.Cpu size={12} />
              </div>
              <span style={s.agentName}>{a.agent_name}</span>
              {/* MonoLink with no href IS the button, so it navigates itself —
                  wrapping it in a <Link> would nest a button inside an anchor. */}
              <MonoLink onClick={() => router.push(`/agents/${a.agent_id}?tab=skills`)}>
                {t("stats.open")}
              </MonoLink>
            </div>
          ))}
        </div>
      )}

      <p style={s.statsFootnote}>
        {data.last_loaded_at
          ? t("stats.lastLoaded", { when: new Date(data.last_loaded_at).toLocaleString() })
          : t("stats.neverLoaded")}
      </p>
    </div>
  );
}
