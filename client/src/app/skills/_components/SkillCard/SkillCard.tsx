/* SkillCard — one skill in the grid: name, type pill, description, source chip,
   the enabled toggle and how many agents load it. Ported from the design's
   SkillCard in screen_skills.jsx. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SOURCE_ICON, TYPE_COLOR } from "./constants";
import { needsVetting } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  usedBy,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  /** How many agents link this skill; omitted while the count is loading. */
  usedBy?: number;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = TYPE_COLOR[skill.type];
  const SourceIcon = Icon[SOURCE_ICON[skill.source]];
  const vetting = needsVetting(skill);

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox(color)}>
          <Icon.Sparkles size={14} />
        </div>
        <span className="mono" style={s.name}>
          {skill.name}
        </span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>

      <div style={s.description}>{skill.description}</div>

      <div style={s.metaRow}>
        <span style={s.typePill(color)}>{t(`listItem.type.${skill.type}`)}</span>
        <span style={s.sourceChip}>
          <SourceIcon size={11} />
          {t(`listItem.source.${skill.source}`)}
        </span>
        {vetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>

      {usedBy != null && usedBy > 0 && (
        <div style={s.footer}>
          <span className="tnum">{t("listItem.usedBy", { count: usedBy })}</span>
          <span className="tnum">{t("listItem.version", { version: skill.version })}</span>
        </div>
      )}
    </div>
  );
}
