"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Icon, SectionLabel } from "@devdigest/ui";
import type { EvalBatchRecord, EvalDashboard as EvalDashboardData } from "@devdigest/shared";
import { useEvalCompare } from "@/lib/hooks/evals";
import { EvalMetricStrip } from "@/components/evals/EvalMetricStrip/EvalMetricStrip";
import { EvalRunsTable } from "@/components/evals/EvalRunsTable/EvalRunsTable";
import { RunCompare } from "@/components/evals/RunCompare/RunCompare";
import { alertText, hasRuns, polylinePoints, trendSegments } from "./helpers";
import type { TrendMetric } from "./helpers";
import { legendSwatchStyle, s, seriesColor } from "./styles";

/**
 * The eval dashboard body: regression banner, metric strip, metric trend and
 * the recent-runs table with its compare flow. Design:
 * `screen_skillslab_evaldashboard.jsx:393-477`.
 *
 * Presentational with respect to the DASHBOARD payload — the page's view owns
 * that query, the agent picker and the run action — but it owns the compare
 * flow end to end, because the selection that arms it lives in the runs table
 * directly below.
 *
 * THREE THINGS THIS COMPONENT REFUSES TO DO:
 *
 *   - Compose the regression sentence. It arrives finished from the server
 *     (AC-57); `dashboard.regressionAlert` is a heading, and the body is the
 *     server's string rendered verbatim. Empty text renders no banner at all
 *     (AC-94), rather than an empty frame.
 *   - Coerce an unknown metric to a number. The trend chart draws a GAP where a
 *     point is unknown instead of a line down to zero, and the strip renders em
 *     dashes — there is no `?? 0` in this folder.
 *   - Announce nothing loudly. The banner and the batch-completion message live
 *     in one `aria-live="polite"` region that is mounted from the first render
 *     and stays EMPTY until there is something to say (NFR-13).
 */
export interface EvalDashboardProps {
  /** The agent's dashboard payload, or `null` / `undefined` before it loads. */
  dashboard: EvalDashboardData | null | undefined;
  /** True while the dashboard query is in flight. */
  isLoading?: boolean;
  /**
   * Rows for the recent-runs table, **newest first** — the order
   * `GET /agents/:id/eval-batches` returns, passed straight through to
   * `EvalRunsTable`, which depends on it to break a `started_at` tie.
   *
   * A separate prop rather than something derived from `dashboard`, because the
   * dashboard payload carries no batch list: `recent_runs` is per-CASE rows and
   * `trend` carries no ids, while comparison is keyed by two batch ids.
   */
  batches?: EvalBatchRecord[];
  /** Optional one-line note under the metric strip. */
  note?: React.ReactNode;
}

/** Viewbox units for the trend chart — it scales to its container's width. */
const CHART_W = 900;
const CHART_H = 200;

const SERIES: TrendMetric[] = ["recall", "precision", "citation_accuracy"];

const LEGEND_KEY: Record<TrendMetric, string> = {
  recall: "dashboard.legend.recall",
  precision: "dashboard.legend.precision",
  citation_accuracy: "dashboard.legend.citation",
};

/**
 * The metric trend, as inline SVG.
 *
 * Private to this file: it has no test and no state of its own
 * (`frontend-architecture` §4). Hand-drawn rather than composed from the
 * vendored `LineChart` for two reasons, both of them this feature's central
 * rule: that component's series take `number[]` and fill a missing entry with
 * `?? 0` (`src/vendor/ui/charts/LineChart.tsx:33`), which turns an unknown
 * metric into a catastrophic-looking zero; and it would pull `recharts` — today
 * imported by nothing but the showcase — onto a brand-new route, against
 * NFR-11's bundle budget.
 *
 * A single trend point renders as a centred dot rather than dividing by zero
 * (AC-95); an unknown point breaks the line into two segments.
 */
function TrendChart({ dashboard, label }: { dashboard: EvalDashboardData; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      style={s.chart}
    >
      {SERIES.map((metric) =>
        trendSegments(dashboard.trend, metric, CHART_W, CHART_H).map((segment, i) => {
          // A segment of one — the whole trend when there is a single batch
          // (AC-95) — has no line to draw, so it is a dot.
          const only = segment.points.length === 1 ? segment.points[0] : null;
          return only ? (
            <circle
              key={`${metric}-${i}`}
              cx={only.x}
              cy={only.y}
              r={3}
              fill={seriesColor(metric)}
            />
          ) : (
            <polyline
              key={`${metric}-${i}`}
              points={polylinePoints(segment)}
              fill="none"
              stroke={seriesColor(metric)}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          );
        }),
      )}
    </svg>
  );
}

export function EvalDashboard({ dashboard, isLoading = false, batches, note }: EvalDashboardProps) {
  const t = useTranslations("eval");

  // The two batches the user picked, in `(older, newer)` order — the compare
  // endpoint reports `b − a`.
  const [pair, setPair] = React.useState<{ older: string; newer: string } | null>(null);
  const compare = useEvalCompare(pair?.older, pair?.newer);

  // "Has a batch been in flight while this page was open?" — history, not a
  // value derivable from the current payload, which is why it is state. It is
  // what lets the completion message appear as a CHANGE inside the live region
  // instead of being present from the first render, where it would announce
  // nothing and read as a permanent caption.
  const status = dashboard?.latest_batch?.status ?? null;
  const [sawRunning, setSawRunning] = React.useState(false);
  React.useEffect(() => {
    if (status === "running") setSawRunning(true);
  }, [status]);

  const alert = alertText(dashboard);
  const statusMessage =
    status === "running"
      ? t("dashboard.batchRunning")
      : sawRunning && status !== null
        ? t("dashboard.batchComplete")
        : null;

  const rows = batches ?? [];
  // Two reads of one screen: the dashboard aggregate and the batch history come
  // from different endpoints, so "has this agent ever run?" is true if EITHER
  // says so. Gating on the aggregate alone would show `noRuns` above a table
  // that has rows in it the moment the two land out of step.
  const everRan = hasRuns(dashboard) || rows.length > 0;

  return (
    <div style={s.root}>
      {pair && (
        <RunCompare
          compare={compare.data}
          isLoading={compare.isLoading}
          onClose={() => setPair(null)}
        />
      )}

      {/* Mounted from the first render and empty until there is something to
          say — a live region that appears together with its text announces
          nothing (NFR-13). */}
      <div style={s.live} aria-live="polite">
        {alert && (
          <div style={s.alert}>
            <Icon.AlertTriangle size={16} style={s.alertIcon} />
            <div>
              <div style={s.alertTitle}>{t("dashboard.regressionAlert")}</div>
              {/* The server's sentence, verbatim. The client neither composes
                  nor rewords it (AC-93). */}
              <div style={s.alertBody}>{alert}</div>
            </div>
          </div>
        )}
        {statusMessage && <div style={s.status}>{statusMessage}</div>}
      </div>

      <EvalMetricStrip dashboard={dashboard} note={note} />

      {isLoading && !dashboard ? (
        <div style={s.loading}>{t("dashboard.loading")}</div>
      ) : !everRan ? (
        // AC-85. The metric strip above still renders its four em dashes, so the
        // shape of the page does not change when the first batch lands.
        <div style={s.noRuns}>{t("dashboard.noRuns")}</div>
      ) : (
        <>
          {dashboard && dashboard.trend.length > 0 && (
            <Card>
              <div style={s.trendHeader}>
                <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
                <div style={s.legend}>
                  {SERIES.map((metric) => (
                    <span key={metric} style={s.legendItem}>
                      <span style={legendSwatchStyle(metric)} />
                      {t(LEGEND_KEY[metric])}
                    </span>
                  ))}
                </div>
              </div>
              <div style={s.chartFrame}>
                <TrendChart dashboard={dashboard} label={t("dashboard.metricTrend")} />
              </div>
            </Card>
          )}

          <EvalRunsTable
            batches={rows}
            onCompare={(older, newer) => setPair({ older: older.id, newer: newer.id })}
          />
        </>
      )}
    </div>
  );
}
