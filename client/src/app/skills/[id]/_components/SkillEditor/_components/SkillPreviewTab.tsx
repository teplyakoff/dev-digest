/* Preview tab — the body rendered as the reviewing agent receives it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "../styles";

export function SkillPreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  return (
    <div style={s.previewWrap}>
      <h2 style={s.h2}>{t("preview.title")}</h2>
      <p style={s.previewSubtitle}>{t("preview.subtitle")}</p>
      <div style={s.previewCard}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
