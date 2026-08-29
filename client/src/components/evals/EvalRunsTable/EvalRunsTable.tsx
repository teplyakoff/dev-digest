"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { EvalBatchRecord } from "@devdigest/shared";
import { RunCostBadge } from "@/components/run-cost-badge/RunCostBadge";
import { compareState, formatPercent, formatRanAt, toggleId } from "./helpers";
import { metricCellStyle, rowStyle, s } from "./styles";

/**
 * The recent-runs table: one row per eval BATCH, with a checkbox column that
 * arms the Compare action. Design:
 * `screen_skillslab_evaldashboard.jsx:461-477`.
 *
 * Rows are batches, not case runs, because comparison is a batch-level
 * operation: `GET /eval-batches/compare?a=&b=` takes two batch ids, and AC-88's
 * "different agents" question is only answerable from `EvalBatchRecord.agent_id`.
 *
 * THREE DECISIONS LIVE HERE:
 *
 *   - Selection is the only thing this component STORES. The Compare action's
 *     enabled state, the pair it would compare and the hint under it are all
 *     computed during render from that one array (`react-best-practices` —
 *     Derive, Don't Store).
 *   - Exactly two rows enable Compare (AC-87); two rows belonging to different
 *     agents leave it disabled (AC-88). The second is the CLIENT's own decision
 *     — the server's `comparable` flag is keyed strictly on provider + model
 *     (NFR-6) and never looks at the agent.
 *   - Nothing here is mouse-only (NFR-12). The row control is a real
 *     `<input type="checkbox">`, so Tab reaches it and Space toggles it, and
 *     Compare is a real `<button>`, so it takes focus and fires on Enter. The
 *     design's `<div>` with a tinted border would look identical and be
 *     unreachable.
 *
 * A batch whose metrics are unknown keeps its row and shows em dashes — there is
 * no `?? 0` in this folder.
 */
export interface EvalRunsTableProps {
  /**
   * The batches to list, **newest first** — the order
   * `GET /agents/:id/eval-batches` returns (`started_at DESC, id DESC`).
   *
   * This component never sorts them, and that is a requirement rather than an
   * omission: `started_at` defaults to transaction time, so two batches can
   * share one exactly, and this array's order is the only thing that can break
   * the tie when the pair is put in `(older, newer)` order. Re-sorting it here
   * would discard the server's `id DESC` tiebreaker and let a tie invert every
   * delta sign.
   */
  batches: EvalBatchRecord[];
  /**
   * Compare two batches. Always called `(older, newer)`: the compare endpoint
   * reports `b − a`, so a reversed pair would flip the sign of every delta.
   */
  onCompare: (older: EvalBatchRecord, newer: EvalBatchRecord) => void;
}

export function EvalRunsTable({ batches, onCompare }: EvalRunsTableProps) {
  const t = useTranslations("eval");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // Read the selection back out of the live list rather than storing rows, so a
  // batch that finishes and re-renders with real numbers stays selected and
  // carries its NEW aggregates into the comparison.
  const selected = batches.filter((b) => selectedIds.includes(b.id));
  const compare = compareState(selected);

  if (batches.length === 0) return null;

  const hint = compare.enabled
    ? t("dashboard.selectedRuns", { count: selected.length })
    : compare.reason === "agents"
      ? t("dashboard.compareDifferentAgents")
      : t("dashboard.compareDisabled");

  const metricCell = (value: number | null, metric: "recall" | "precision" | "citation") => {
    const text = formatPercent(value);
    return text === null ? (
      <span className="tnum" style={s.unknown} title={t("dashboard.unknownTooltip")}>
        {t("dashboard.unknownValue")}
      </span>
    ) : (
      <span className="tnum" style={metricCellStyle(metric)}>
        {text}
      </span>
    );
  };

  return (
    <div>
      <div style={s.header}>
        <div style={s.headerLabel}>
          <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
        </div>
        <span style={s.hint}>{hint}</span>
        <div style={s.headerActions}>
          <Button
            kind={compare.enabled ? "primary" : "ghost"}
            size="sm"
            disabled={!compare.enabled}
            onClick={() => {
              if (compare.enabled) onCompare(compare.older, compare.newer);
            }}
          >
            {t("dashboard.compare")}
          </Button>
        </div>
      </div>

      <div style={s.frame}>
        <table style={s.table}>
          <thead>
            <tr>
              <th scope="col" style={s.thSelect} />
              <th scope="col" style={s.th}>
                {t("dashboard.table.ranAt")}
              </th>
              <th scope="col" style={s.th}>
                {t("dashboard.table.recall")}
              </th>
              <th scope="col" style={s.th}>
                {t("dashboard.table.precision")}
              </th>
              <th scope="col" style={s.th}>
                {t("dashboard.table.citation")}
              </th>
              <th scope="col" style={s.th}>
                {t("dashboard.table.cost")}
              </th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => (
              <tr key={batch.id} style={rowStyle(selectedIds.includes(batch.id))}>
                <td style={s.tdSelect}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(batch.id)}
                    onChange={() => setSelectedIds((ids) => toggleId(ids, batch.id))}
                    aria-label={t("dashboard.selectRun")}
                    style={s.checkbox}
                  />
                </td>
                <td className="mono" style={s.td}>
                  <span style={s.ranAt}>{formatRanAt(batch.started_at)}</span>
                </td>
                <td style={s.td}>{metricCell(batch.recall, "recall")}</td>
                <td style={s.td}>{metricCell(batch.precision, "precision")}</td>
                <td style={s.td}>{metricCell(batch.citation_accuracy, "citation")}</td>
                {/* `RunCostBadge` already renders an em dash for a null cost and
                    never `$0.00` — the same "unknown is not zero" rule this
                    table applies to the three metrics. */}
                <td style={s.td}>
                  <RunCostBadge usd={batch.cost_usd} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
