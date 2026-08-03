/* Versions tab — every body snapshot, newest first. Read-only in L02: diff and
   restore are a later lesson. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, ErrorState, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions } from "../../../../../../lib/hooks/skills";
import { s } from "../styles";

/** First non-empty line of the snapshot, as a one-line "what changed" hint. */
function excerpt(body: string): string {
  return body.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "—";
}

export function SkillVersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: versions, isLoading, isError, refetch } = useSkillVersions(skill.id);

  if (isLoading) return <Skeleton height={160} />;
  if (isError) return <ErrorState body={t("versions.loadError")} onRetry={() => refetch()} />;

  return (
    <div style={s.versionsWrap}>
      <div style={s.versionsHead}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">
          {t("versions.count", { count: versions?.length ?? 0 })}
        </Badge>
      </div>
      <p style={s.versionsSubtitle}>{t("versions.subtitle")}</p>

      <div style={s.versionList}>
        {(versions ?? []).map((v) => {
          const current = v.version === skill.version;
          return (
            <div key={v.version} style={s.versionRow(current)}>
              <span className="mono" style={s.versionTag(current)}>
                v{v.version}
              </span>
              <div style={s.versionMeta}>
                <div style={s.versionExcerpt}>{excerpt(v.body)}</div>
                <div style={s.versionDate}>{new Date(v.created_at).toLocaleString()}</div>
              </div>
              {current && (
                <Badge color="var(--ok)" bg="var(--ok-bg)" dot>
                  {t("versions.current")}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
