/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps.

   Also carries the one-click "turn into eval case" action (SPEC-08 AC-62…AC-68).
   The click creates immediately — this card never opens a dialog, which is the
   criterion AC-65 is graded on. Everything about it arrives as props: the card
   stays presentational and FindingsPanel owns the mutation. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

export function FindingCard({
  f,
  focused,
  defaultExpanded,
  expandNonce,
  onAction,
  pending,
  onCreateEvalCase,
  creatingEvalCase,
  evalCaseHref,
  existingEvalCaseHref,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  /** INITIAL state only — it feeds `useState`, so changing it later does
   *  nothing. Use `expandNonce` to expand a card that is already mounted. */
  defaultExpanded?: boolean;
  /** Bump to expand this card now (deep link from the Files tab). */
  expandNonce?: number;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  pending?: boolean;
  /** Seed an eval case from this finding — a SEPARATE prop, deliberately not a
   *  `FindingActionKind`. That union is the set of server verbs that mutate the
   *  finding; creating a case writes a different table on a different route and
   *  invalidates a different query, so widening it would make
   *  `POST /findings/:id/accept`-shaped code type-legal for something that is
   *  not a finding mutation at all. */
  onCreateEvalCase?: () => void;
  /** True while THIS finding's case is in flight. The disabled state it produces
   *  is what prevents a second click — not a second request. */
  creatingEvalCase?: boolean;
  /** Where the case just created from this finding can be edited. Known only
   *  from the create response; no route serves "cases for finding X". */
  evalCaseHref?: string | null;
  /** A case that already existed for this finding, if the create response
   *  reported one (AC-68). Creating a duplicate is allowed — the reader is told,
   *  not blocked. */
  existingEvalCaseHref?: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  // Expand-only: a later bump never collapses a card the reader opened.
  React.useEffect(() => {
    if (expandNonce) setExpanded(true);
  }, [expandNonce]);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  // There is no status column: "decided" is derived from the two timestamps,
  // and a finding with neither is open. Seeding a case from an open finding
  // would pin an expectation nobody agreed to, so the action is disabled for it
  // (AC-63) rather than defaulting to `must_find`.
  const decided = accepted || dismissed;
  const muted = decided;
  // The tooltip names the case the click will actually create — the direction is
  // the SERVER's derivation from the same two timestamps (accepted → must_find,
  // dismissed → must_not_flag), so this reads the decision, never a default.
  const createEvalCaseTitle = !decided
    ? t("finding.createEvalCaseDisabled")
    : accepted
      ? t("finding.createEvalCaseMustFind")
      : t("finding.createEvalCaseMustNotFlag");

  return (
    <div data-finding-id={f.id} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
          </div>
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!decided}
              loading={!!creatingEvalCase}
              title={createEvalCaseTitle}
              onClick={() => onCreateEvalCase?.()}
            >
              {t("finding.createEvalCase")}
            </Button>
          </div>

          {(evalCaseHref || existingEvalCaseHref) && (
            <div style={s.evalCaseLinks}>
              {evalCaseHref && (
                <a href={evalCaseHref} style={s.evalCaseLink}>
                  {t("finding.editEvalCase")}
                </a>
              )}
              {existingEvalCaseHref && (
                <a href={existingEvalCaseHref} style={s.evalCaseLink}>
                  {t("finding.viewEvalCase")}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
