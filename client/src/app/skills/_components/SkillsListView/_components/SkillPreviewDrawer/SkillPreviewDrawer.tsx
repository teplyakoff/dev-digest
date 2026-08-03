/* SkillPreviewDrawer — read-only body preview beside the grid. Answers "what
   does this skill actually say"; the editor answers "change it". */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Badge, Button, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { Drawer } from "@devdigest/ui";
import { estimateTokens } from "../../../../../../lib/tokens";
import { needsVetting } from "../../../SkillCard/helpers";
import { PREVIEW_WIDTH } from "../../constants";
import { s } from "./styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();

  return (
    <Drawer
      width={PREVIEW_WIDTH}
      title={<span className="mono">{skill.name}</span>}
      subtitle={skill.description}
      onClose={onClose}
      footer={
        <Button
          kind="primary"
          size="sm"
          icon="Edit"
          onClick={() => router.push(`/skills/${skill.id}?tab=config`)}
        >
          {t("preview.openEditor")}
        </Button>
      }
    >
      <div style={s.metaRow}>
        <Badge color="var(--text-secondary)" icon="GitCommit">
          {t("preview.version", { version: skill.version })}
        </Badge>
        <Badge
          color={skill.enabled ? "var(--ok)" : "var(--text-muted)"}
          bg={skill.enabled ? "var(--ok-bg)" : undefined}
          dot
        >
          {skill.enabled ? t("preview.enabled") : t("preview.disabled")}
        </Badge>
        {/* What this skill costs every run that loads it — the drawer answers
            "what does it say", and this is half of "what does it cost". */}
        <span className="mono" style={s.tokens}>
          {t("preview.tokens", { count: estimateTokens(skill.body).toLocaleString("en-US") })}
        </span>
      </div>

      {needsVetting(skill) && <div style={s.vetting}>{t("preview.vettingNotice")}</div>}

      <div style={s.body}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </Drawer>
  );
}
