/* PrBriefCard — "how risky is this, and what do I read first", at the top of
   the PR's Overview tab, above the Intent / Blast pair.

   PURELY PRESENTATIONAL: props in, JSX out. No fetching, no state, nothing
   derived from props parked in a `useState`. `OverviewTab` owns `usePrBrief` /
   `useRebuildBrief` and hands the results down — which is also what lets
   `OverviewTab.test.tsx` prove the card renders from MOCKED API DATA rather
   than from a hand-passed prop (client/INSIGHTS.md, 2026-08-05).

   WHAT IS DELIBERATELY NOT HERE (AC-57): the review verdict, findings counts,
   blocker counts and the PR score. The design mock draws all four inside a
   block labelled "PR BRIEF", but those are `VerdictBanner`'s props and they
   come from a finished review run — a different artifact with a different
   lifetime. The banner stays in `?tab=findings`.

   Contract imports are TYPE-ONLY: a value import from `@devdigest/shared` drags
   the barrel plus `zod` into the shared chunk, ~15 kB on every route (NFR-6). */
"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { BriefRiskLevel, PrBriefRecord, Risk } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge/RunCostBadge";
import { s, riskDotFor, riskPillFor } from "./styles";

/** AC-40. Ten is the ceiling the card renders; the count beside it (AC-41) is
 *  the length of the WHOLE list, so a truncation is never silent. The server
 *  does not truncate this list — it was tried there and removed, because a
 *  pre-trimmed array makes AC-41 unsatisfiable. */
const MAX_FOCUS_ITEMS = 10;

/** high → medium → low. `sort` is stable, so risks of equal severity keep the
 *  order the server sent them in (AC-45). */
const SEVERITY_RANK: Record<BriefRiskLevel, number> = { high: 0, medium: 1, low: 2 };

interface PrBriefCardProps {
  /** `null` = never built (AC-53). `undefined` while the query is in flight —
   *  but do not read the difference off this prop, pass `loading` instead. */
  brief: PrBriefRecord | null | undefined;
  /** The brief query is in flight. SEPARATE from `brief == null` on purpose:
   *  see the loading branch below. */
  loading?: boolean;
  /** The brief request FAILED — a different state from "never built" (AC-54),
   *  and the reason the two are separate props rather than one tri-state. */
  error?: boolean;
  onRetry?: () => void;
  /** Server-computed: the stored brief was built against another head (AC-50). */
  stale?: boolean;
  /** Server-computed: this response was served from storage, no model call
   *  (AC-48). */
  reused?: boolean;
  onRebuild: () => void;
  rebuilding?: boolean;
  /** Activating a review-focus item hands its PATH — never a line — back to the
   *  page, which turns it into `?tab=diff&view=smart&file=<path>`. */
  onOpenFile: (path: string) => void;
}

export function PrBriefCard({
  brief,
  loading,
  error,
  onRetry,
  stale,
  reused,
  onRebuild,
  rebuilding,
  onOpenFile,
}: PrBriefCardProps) {
  const t = useTranslations("prReview");

  // IN FLIGHT IS NOT THE SAME STATE AS NEVER BUILT, and the loading branch
  // therefore renders NO ACTION AT ALL — the rule `IntentCard` already follows,
  // for a sharper reason here: a click landing in this window spends a real
  // model call, two on a PR whose intent has to be derived first.
  if (loading) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Shield">{t("brief.heading")}</SectionLabel>
        <Skeleton height={72} />
      </Card>
    );
  }

  // THE REQUEST FAILED — not "there is no brief". Collapsing the two would offer
  // a build button for a brief that may well already exist, and hide the fact
  // that the page is showing nothing because it could not read, not because
  // there is nothing to read (AC-54).
  if (error) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Shield">{t("brief.heading")}</SectionLabel>
        <div style={s.emptyState}>
          <span style={s.dropped}>
            <Icon.AlertTriangle size={13} style={s.droppedIcon} />
            {t("brief.errorTitle")}
          </span>
          <span style={s.empty}>{t("brief.errorBody")}</span>
          {onRetry && (
            <Button kind="secondary" size="sm" icon="RefreshCw" onClick={onRetry}>
              {t("brief.retry")}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // Never built: a call to build it, not an empty card (AC-53). This state is
  // reachable only because the server answers an unbuilt brief with a 200 and a
  // null (server AC-67) instead of a 404.
  if (brief == null) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Shield">{t("brief.heading")}</SectionLabel>
        <div style={s.emptyState}>
          <span style={s.empty}>{t("brief.none")}</span>
          <Button
            kind="secondary"
            size="sm"
            icon="Sparkles"
            loading={rebuilding}
            disabled={rebuilding}
            onClick={onRebuild}
          >
            {t("brief.build")}
          </Button>
        </div>
      </Card>
    );
  }

  // Everything below is computed DURING RENDER from the props. Nothing here is
  // stored, so nothing here can go stale against the brief it describes.
  const risks = [...brief.risks].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const focus = brief.review_focus.slice(0, MAX_FOCUS_ITEMS);
  const focusHidden = brief.review_focus.length > focus.length;
  const derivedAt = new Date(brief.derived_at);
  const when = Number.isNaN(derivedAt.getTime()) ? brief.derived_at : derivedAt.toLocaleString();

  return (
    <Card style={s.wrap}>
      <SectionLabel
        icon="Shield"
        right={
          <div style={s.headerActions}>
            {reused && (
              <Badge color="var(--text-muted)" bg="transparent" icon="Database">
                {t("brief.cached")}
              </Badge>
            )}
            {stale && (
              <Badge color="var(--text-muted)" bg="transparent">
                {t("brief.stale")}
              </Badge>
            )}
            {/* "Rebuild brief", NOT "Re-derive": after this feature the Overview
                tab carries TWO regeneration buttons side by side, and two
                controls with the same accessible name is a defect this page has
                already shipped once (client/INSIGHTS.md, 2026-08-10). NFR-7. */}
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={rebuilding}
              disabled={rebuilding}
              onClick={onRebuild}
            >
              {t("brief.rebuild")}
            </Button>
          </div>
        }
      >
        {t("brief.heading")}
      </SectionLabel>

      {/* The risk level reads FIRST, and it is a word before it is a colour:
          `riskPillFor` paints it, the translated label carries it for anyone the
          colour never reaches (AC-37, NFR-7). */}
      <div style={s.headline}>
        <span style={riskPillFor(brief.risk_level)}>{t(`brief.riskLevel.${brief.risk_level}`)}</span>
      </div>

      <p style={s.what}>{brief.what}</p>
      <p style={s.why}>{brief.why}</p>

      <div style={s.section}>
        <div style={s.colLabel}>
          <Icon.AlertOctagon size={12} />
          {t("brief.risks")}
        </div>
        {/* Grounding dropped every risk the model returned: say so. The headline
            level above is still the model's (server AC-12), so without this line
            "no risks" and "we could not confirm any of them" render the same
            (AC-46). */}
        {brief.risks_grounded === false && (
          <span style={s.ungrounded}>
            <Icon.AlertTriangle size={13} style={s.droppedIcon} />
            {t("brief.ungrounded")}
          </span>
        )}
        {risks.length > 0 ? (
          <ul style={s.riskList}>
            {risks.map((risk: Risk) => (
              <li key={`${risk.severity}:${risk.title}`} style={s.riskRow}>
                <span style={riskDotFor(risk.severity)} />
                <span>
                  <span style={s.riskTitle}>{risk.title}</span>{" "}
                  <span style={s.riskBody}>{risk.explanation}</span>
                  {risk.file_refs.length > 0 && (
                    <span className="mono" style={s.riskRefs}>
                      {risk.file_refs.join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span style={s.empty}>{t("brief.noRisks")}</span>
        )}
      </div>

      {/* INSIDE the same card (AC-39) rather than a section of its own: the
          reading order the brief proposes only means anything next to the risk
          level that motivates it. */}
      <div style={s.section}>
        <div style={s.colLabel}>
          <Icon.Target size={12} />
          {t("brief.focus")}
        </div>
        {focus.length > 0 ? (
          <ul style={s.focusList}>
            {focus.map((item) => (
              <li key={item.path}>
                {/* A real button, so Tab reaches it and Enter activates it
                    (NFR-7); its accessible name carries the FULL path even when
                    the visible one is ellipsized, and `title` shows the full
                    path on hover. There is no line number here and there will
                    not be one — see `ReviewFocusItem` in the contract. */}
                <button
                  type="button"
                  style={s.focusButton}
                  title={item.path}
                  aria-label={t("brief.openFile", { path: item.path })}
                  onClick={() => onOpenFile(item.path)}
                >
                  <span className="mono" style={s.focusPath}>
                    {item.path}
                  </span>
                  <span style={s.focusReason}>{item.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span style={s.empty}>{t("brief.focusEmpty")}</span>
        )}
        {/* The REAL length, not the rendered one: a list capped at ten that
            reports ten is a silent truncation (AC-41). */}
        {focusHidden && (
          <span style={s.focusMore}>
            {t("brief.focusCount", { shown: focus.length, total: brief.review_focus.length })}
          </span>
        )}
      </div>

      <div style={s.footer}>
        <div style={s.footerRow}>
          {/* `cost_usd: null` is UNKNOWN and renders an em-dash; `0` is free and
              renders as a number. `RunCostBadge` already draws that distinction
              and is reused rather than re-formatted here (AC-47, AC-49). */}
          <RunCostBadge
            usd={brief.cost_usd}
            tokensIn={brief.tokens_in}
            tokensOut={brief.tokens_out}
          />
          <span>{t("brief.builtBy", { model: `${brief.provider}/${brief.model}`, when })}</span>
        </div>
        {/* Which named input blocks the token budget removed, in the order it
            removed them — `context-docs:<name>`, `file-stats:numbers`. A brief
            built on a partial input and one built on the whole thing are
            otherwise indistinguishable (AC-56). */}
        {brief.dropped_blocks.length > 0 && (
          <span style={s.dropped}>
            <Icon.AlertTriangle size={13} style={s.droppedIcon} />
            {t("brief.dropped")} <span className="mono">{brief.dropped_blocks.join(", ")}</span>
          </span>
        )}
      </div>
    </Card>
  );
}
