"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Modal, SectionLabel } from "@devdigest/ui";
import type { EvalBatchCompare } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge/RunCostBadge";
import {
  deltaDirection,
  diffTokens,
  formatDeltaCost,
  formatDeltaPoints,
  formatPercent,
  promptDiffState,
} from "./helpers";
import { deltaStyle, diffTokenStyle, legendSwatchStyle, s } from "./styles";

/**
 * "Old prompt vs new": two batches side by side, four independent deltas, and a
 * word-level diff of the two system-prompt snapshots. Design:
 * `screen_skillslab_evaldashboard.jsx:316-341`.
 *
 * FOUR DELTAS, FOUR CRITERIA — recall (AC-107), precision (AC-108), citation
 * accuracy (AC-109) and cost (AC-110). They were one compound criterion until
 * the spec amendment split them, precisely so that a run in which the *cost*
 * delta silently stopped rendering has somewhere to fail. Each is rendered from
 * its own field and each can be absent on its own.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT HAVE: any action that promotes an
 * agent version (AC-96). The design makes "Promote v7" the modal's primary
 * footer button; its absence is a criterion, so the footer holds Close alone.
 *
 * The diff is computed here, in the browser, from two stored strings — zero
 * model calls — and rendered as TEXT. Nothing on this path uses
 * `dangerouslySetInnerHTML`: the same viewer shape is used for case diffs, whose
 * content is not internally authored.
 */
export interface RunCompareProps {
  /** The loaded comparison, or `null` / `undefined` while it is in flight. */
  compare: EvalBatchCompare | null | undefined;
  /** True while the compare query is loading, so the modal can open immediately. */
  isLoading?: boolean;
  /** Close — the Close button, the ✕, the backdrop and Escape. */
  onClose: () => void;
}

const MODAL_WIDTH = 960;

/** Everything Tab can move focus onto inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One metric's before → after, with its delta.
 *
 * Private to this file: it has no test and no helpers of its own, so a folder
 * would be ceremony (`frontend-architecture` §4). The DELTA is rendered only
 * when it exists — an absent delta is absent, not `▲ 0pt` — while the two
 * values are always shown, each falling back to the em dash when unknown.
 */
function DeltaCard({
  label,
  oldValue,
  newValue,
  delta,
  invert = false,
}: {
  label: string;
  oldValue: React.ReactNode;
  newValue: React.ReactNode;
  /** Already formatted, or `null` when there is no delta to show. */
  delta: { text: string; direction: "up" | "down" | "flat" } | null;
  invert?: boolean;
}) {
  return (
    <div style={s.card}>
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardValues}>
        <span className="tnum" style={s.oldValue}>
          {oldValue}
        </span>
        <Icon.ArrowRight size={13} style={s.arrow} />
        <span className="tnum" style={s.newValue}>
          {newValue}
        </span>
        {delta && (
          <span className="tnum" style={deltaStyle(delta.direction, invert)}>
            {delta.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function RunCompare({ compare, isLoading = false, onClose }: RunCompareProps) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const rootRef = React.useRef<HTMLDivElement>(null);

  // A modal traps focus and offers an escape path (`react-best-practices` —
  // Accessibility). The vendored `Modal` primitive provides neither and is
  // frozen, so both live here — the same shape `EvalCaseEditor` uses.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = rootRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      const outside = !(active instanceof HTMLElement) || !dialog.contains(active);
      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const unknown = (
    <span style={s.unknown} title={t("dashboard.unknownTooltip")}>
      {t("dashboard.unknownValue")}
    </span>
  );

  const percent = (value: number | null) => formatPercent(value) ?? unknown;

  const pointsDelta = (value: number | null) => {
    const text = formatDeltaPoints(value);
    const direction = deltaDirection(value);
    return text && direction ? { text, direction } : null;
  };

  const costDelta = () => {
    if (!compare) return null;
    const text = formatDeltaCost(compare.deltas.cost_usd);
    const direction = deltaDirection(compare.deltas.cost_usd);
    return text && direction ? { text, direction } : null;
  };

  const diff = compare
    ? promptDiffState(
        compare.prompt_diff_available,
        compare.a.system_prompt_snapshot,
        compare.b.system_prompt_snapshot,
      )
    : null;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("dashboard.compareTitle")}
      onClose={onClose}
      footer={
        // AC-96: Close, and nothing that promotes a version. The design's
        // primary footer button ("Promote v7") is out of scope by criterion,
        // not by omission.
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {tCommon("actions.close")}
          </Button>
        </div>
      }
    >
      <div ref={rootRef} style={s.body}>
        {!compare ? (
          <div style={s.loading}>
            {isLoading ? t("dashboard.loading") : tCommon("states.empty")}
          </div>
        ) : (
          <>
            {/* AC-92 / NFR-6: the server decides comparability from provider +
                model, and the client displays that decision. A metric that moved
                between two different models says nothing about the prompt, which
                is the only thing this comparison is for. */}
            {!compare.comparable && (
              <div style={s.incomparable}>
                <Icon.AlertTriangle size={16} style={s.warnIcon} />
                <div>
                  <div style={s.incomparableTitle}>{t("dashboard.incomparable")}</div>
                  <div style={s.incomparableHint}>{t("dashboard.incomparableHint")}</div>
                </div>
              </div>
            )}

            <div style={s.deltas}>
              <DeltaCard
                label={t("dashboard.deltaRecall")}
                oldValue={percent(compare.a.recall)}
                newValue={percent(compare.b.recall)}
                delta={pointsDelta(compare.deltas.recall)}
              />
              <DeltaCard
                label={t("dashboard.deltaPrecision")}
                oldValue={percent(compare.a.precision)}
                newValue={percent(compare.b.precision)}
                delta={pointsDelta(compare.deltas.precision)}
              />
              <DeltaCard
                label={t("dashboard.deltaCitation")}
                oldValue={percent(compare.a.citation_accuracy)}
                newValue={percent(compare.b.citation_accuracy)}
                delta={pointsDelta(compare.deltas.citation_accuracy)}
              />
              <DeltaCard
                label={t("dashboard.deltaCost")}
                // `RunCostBadge` renders an em dash for an unknown cost and
                // never `$0.00` (server AC-52, inherited by AC-110).
                oldValue={<RunCostBadge usd={compare.a.cost_usd} />}
                newValue={<RunCostBadge usd={compare.b.cost_usd} />}
                delta={costDelta()}
                // On cost, cheaper is better — the arrow's colour is inverted.
                invert
              />
            </div>

            <SectionLabel icon="FileText">{t("dashboard.promptDiff")}</SectionLabel>

            {diff === "missing" && (
              <div style={s.diffMessage}>{t("dashboard.noPromptSnapshot")}</div>
            )}
            {diff === "identical" && (
              <div style={s.diffMessage}>{t("dashboard.promptsIdentical")}</div>
            )}
            {diff === "diff" && (
              <>
                <div style={s.legend}>
                  <span style={s.legendItem}>
                    <span style={legendSwatchStyle("old")} />
                    {t("dashboard.legendOld")}
                  </span>
                  <span style={s.legendItem}>
                    <span style={legendSwatchStyle("new")} />
                    {t("dashboard.legendNew")}
                  </span>
                </div>
                <div className="mono" style={s.diff}>
                  {diffTokens(
                    compare.a.system_prompt_snapshot ?? "",
                    compare.b.system_prompt_snapshot ?? "",
                  ).map((token, i) => (
                    <span key={i} style={diffTokenStyle(token.kind)}>
                      {token.text}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
