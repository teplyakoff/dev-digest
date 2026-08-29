"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { deltaPoints, formatDeltaPoints, formatPercent, formatRatio } from "./helpers";
import type { MetricTone } from "./helpers";
import { deltaBadgeStyle, metricValueStyle, s } from "./styles";

/**
 * The four-tile eval metric strip: recall, precision, citation accuracy and
 * cases passed (AC-71). Design: `screen_agents.jsx:139-155`.
 *
 * Lives in `components/evals/` rather than a route-local `_components/` because
 * it has TWO consumers today — the agent editor's Evals tab and the standalone
 * eval dashboard (`frontend-architecture` §1, placement by consumer count now).
 *
 * It takes the whole `EvalDashboard` payload rather than four loose numbers so
 * that the three "unknown is not zero" rules are decided HERE, once, instead of
 * in each consumer:
 *
 *   - no batch at all → an em dash in every tile, and `0%` never reaches the DOM
 *     (AC-72);
 *   - a `null` metric → an em dash, and `100%` never reaches the DOM (AC-74);
 *   - no previous batch → NO delta badge, rather than `▲ 0pt` (AC-73). A delta
 *     that is genuinely zero IS rendered — absence and "moved by zero" must not
 *     look alike.
 *
 * `dashboard` is `undefined` while the query is in flight, which renders the
 * same honest dashes as "never ran": neither state has a number to show.
 */
export interface EvalMetricStripProps {
  /** The agent's eval dashboard, or `null` / `undefined` before it has loaded. */
  dashboard: EvalDashboard | null | undefined;
  /**
   * Optional one-line note under the strip — the design puts "Scoring is
   * mechanical…" here (`screen_agents.jsx:157-160`). Passed in already
   * translated, because the string is the consumer's copy, not this component's.
   */
  note?: React.ReactNode;
}

interface Tile {
  key: string;
  label: string;
  /** The formatted value, or `null` for unknown → the em dash. */
  text: string | null;
  tone: MetricTone;
  /** Whole percentage points, or `null` → no badge at all. */
  delta: number | null;
}

export function EvalMetricStrip({ dashboard, note }: EvalMetricStripProps) {
  const t = useTranslations("eval");
  const current = dashboard?.current;
  // `delta` is null as a WHOLE object when there is no previous batch; an
  // individual field is null when the metric was unknown in either batch.
  const delta = dashboard?.delta;

  // Derived during render, never stored (`react-best-practices` — Derive, Don't
  // Store). Four tiles, computed from the payload every time it changes.
  const tiles: Tile[] = [
    {
      key: "recall",
      label: t("dashboard.metrics.recall"),
      text: formatPercent(current?.recall),
      tone: "accent",
      delta: deltaPoints(delta?.recall),
    },
    {
      key: "precision",
      label: t("dashboard.metrics.precision"),
      text: formatPercent(current?.precision),
      tone: "ok",
      delta: deltaPoints(delta?.precision),
    },
    {
      key: "citationAccuracy",
      label: t("dashboard.metrics.citationAccuracy"),
      text: formatPercent(current?.citation_accuracy),
      tone: "warn",
      delta: deltaPoints(delta?.citation_accuracy),
    },
    {
      // `dashboard.metrics.tracesPassed`, NOT an `evalsTab` twin: its three
      // siblings live here and this component is rendered from both features.
      key: "tracesPassed",
      label: t("dashboard.metrics.tracesPassed"),
      text: formatRatio(current?.traces_passed, current?.traces_total),
      tone: "neutral",
      // Deliberately never a delta — the design gives this tile none, and a
      // pass count moving is already visible in the count itself.
      delta: null,
    },
  ];

  // AC-81: a partial batch is one where at least one case ERRORED, so its
  // aggregates cover fewer cases than the set. Shown beside the aggregates it
  // qualifies, with no way to dismiss it.
  const partial = current?.partial === true;

  return (
    <div>
      <div style={s.strip}>
        {tiles.map((tile) => (
          <div key={tile.key} style={s.tile}>
            <div style={s.label}>{tile.label}</div>
            <div style={s.valueRow}>
              {tile.text === null ? (
                <span className="tnum" style={s.unknown} title={t("dashboard.unknownTooltip")}>
                  {t("dashboard.unknownValue")}
                </span>
              ) : (
                <span className="tnum" style={metricValueStyle(tile.tone)}>
                  {tile.text}
                </span>
              )}
              {tile.delta !== null && (
                <span className="tnum" style={deltaBadgeStyle(tile.delta)}>
                  {formatDeltaPoints(tile.delta)}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {(partial || note) && (
        <div style={s.footer}>
          {partial && (
            // `Badge` takes no `title`, so the tooltip lives on the wrapper.
            <span style={s.partialWrap} title={t("evalsTab.partialTooltip")}>
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("evalsTab.partial")}
              </Badge>
            </span>
          )}
          {note && <div style={s.note}>{note}</div>}
        </div>
      )}
    </div>
  );
}
