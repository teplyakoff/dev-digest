/* ConventionCard — one extracted rule, its verified evidence, and the three
   decisions a person can make about it. Ported from the design's ConventionCard,
   plus an Edit action the design does not have (the assignment requires editing
   a rule before it becomes a skill) and Reject as a STATE rather than a
   disappearance. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, MonoLink, ProgressBar } from "@devdigest/ui";
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";
import { HIGH_CONFIDENCE } from "../../constants";
import { evidenceLabel, evidenceUrl } from "../../helpers";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  scan,
  repoFullName,
  onAccept,
  onReject,
  onEdit,
  busy,
}: {
  candidate: ConventionCandidate;
  scan: ConventionScan | null | undefined;
  repoFullName: string | null | undefined;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("conventions");
  const accepted = candidate.status === "accepted";
  const rejected = candidate.status === "rejected";
  const href = evidenceUrl(candidate, scan, repoFullName);
  const label = evidenceLabel(candidate);
  const percent = Math.round(candidate.confidence * 100);

  return (
    <div style={s.card(candidate.status)}>
      <div style={s.row}>
        <div style={s.main}>
          <div style={s.rule}>{candidate.rule}</div>

          <div style={s.evidence}>
            <div style={s.evidenceHeader}>
              {/* A real link, pinned to the SHA the sample was read at, so the
                  highlighted lines still hold the code the snippet shows. */}
              {href ? (
                <MonoLink href={href}>{label}</MonoLink>
              ) : (
                <span className="mono" style={s.metaLabel}>
                  {label}
                </span>
              )}
            </div>
            <pre className="mono" style={s.snippet}>
              {candidate.evidence_snippet}
            </pre>
          </div>

          <div style={s.metaRow}>
            <span style={s.metaLabel}>{t("card.confidence")}</span>
            <div style={s.bar}>
              <ProgressBar
                value={percent}
                height={5}
                color={candidate.confidence >= HIGH_CONFIDENCE ? "var(--ok)" : "var(--warn)"}
              />
            </div>
            <span className="mono tnum" style={s.percent}>
              {percent}%
            </span>
            <span style={s.categoryPill}>{t(`card.category.${candidate.category}`)}</span>
          </div>
        </div>

        <div style={s.actions}>
          <Button
            kind={accepted ? "primary" : "secondary"}
            size="sm"
            icon={accepted ? "Check" : "Plus"}
            full
            disabled={busy}
            onClick={onAccept}
          >
            {accepted ? t("card.accepted") : t("card.accept")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon={rejected ? "RefreshCw" : "X"}
            full
            disabled={busy}
            onClick={onReject}
          >
            {rejected ? t("card.undo") : t("card.reject")}
          </Button>
          <Button kind="ghost" size="sm" icon="Edit" full disabled={busy} onClick={onEdit}>
            {t("card.edit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
