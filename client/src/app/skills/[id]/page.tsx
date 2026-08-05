/* /skills/:id — Skill editor (A1, L02). Left skills list + tabbed editor, the
   same shape as /agents/:id. Tab state lives in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { ApiError } from "../../../lib/api";
import { useSkill, useSkills, useUpdateSkill } from "../../../lib/hooks/skills";
import { SkillCard } from "../_components/SkillCard/SkillCard";
import { TYPE_COLOR } from "../_components/SkillCard/constants";
import { SkillEditor } from "./_components/SkillEditor/SkillEditor";
import { VALID_TABS } from "./_components/SkillEditor/constants";
import { s } from "./styles";

export default function SkillEditorPage() {
  const t = useTranslations("skills");
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const update = useUpdateSkill();

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (next: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", next);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.loadErrorTitle")}
          body={error instanceof ApiError ? error.message : t("detail.loadError")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.split}>
        {/* left: skills list */}
        <div style={s.listCol}>
          <div style={s.listHead}>
            <h1 style={s.listTitle}>{t("detail.listTitle")}</h1>
          </div>
          <div style={s.listScroll}>
            {(skills ?? []).map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div style={s.skeletonCol}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={s.editorCol}>
            <div style={s.editorHead}>
              <Icon.Sparkles size={18} style={s.typeIcon(TYPE_COLOR[skill.type])} />
              <h1 className="mono" style={s.editorTitle}>
                {skill.name}
              </h1>
              <Badge color="var(--text-secondary)" icon="GitCommit">
                {t("preview.version", { version: skill.version })}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>}
            </div>
            <div style={s.editorScroll}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
