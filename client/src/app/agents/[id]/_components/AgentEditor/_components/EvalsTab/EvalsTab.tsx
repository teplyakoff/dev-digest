/* EvalsTab — the agent's eval set and what the last batch measured.
   Design: `screen_agents.jsx:157-178`.

   Two things the design does that this does NOT:
     - it hardcodes a "20-trace gold set" and `17/20` beside a list of nine
       cases. AC-75 takes every count from the fetched set instead, which is why
       the caption below reads `dashboard.casesSummary` off the real payload.
     - it renders the metric tiles inline. They live in `components/evals/
       EvalMetricStrip` because the standalone dashboard renders them too, and
       the three "unknown is not zero" rules are decided there once rather than
       here and there. */
"use client";

import React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, SectionLabel } from "@devdigest/ui";
import type { Agent, EvalCaseRecord } from "@devdigest/shared";
import { EvalCaseEditor } from "@/components/evals/EvalCaseEditor/EvalCaseEditor";
import { EvalMetricStrip } from "@/components/evals/EvalMetricStrip/EvalMetricStrip";
import {
  useDeleteEvalCase,
  useEvalCases,
  useEvalDashboard,
  useRunEvalBatch,
} from "@/lib/hooks/evals";
import { EvalCaseRow } from "./_components/EvalCaseRow/EvalCaseRow";
import { isBatchRunning, lastRunByCase } from "./helpers";
import { s } from "./styles";

export interface EvalsTabProps {
  agent: Agent;
}

/**
 * What the case-editor modal is doing, or `null` when it is closed.
 *
 * `evalCase: null` is the "New eval case" entry point and a record is the
 * "edit this one" entry point — AC-97's two entry points, and there is no
 * third. The seeding path deliberately does not open this modal at all.
 */
type EditorState = { evalCase: EvalCaseRecord | null } | null;

export function EvalsTab({ agent }: EvalsTabProps) {
  const t = useTranslations("eval");
  const search = useSearchParams();
  const [editor, setEditor] = React.useState<EditorState>(null);

  const cases = useEvalCases(agent.id);
  const dashboard = useEvalDashboard(agent.id);
  const runBatch = useRunEvalBatch(agent.id);
  const deleteCase = useDeleteEvalCase();

  /**
   * `?case=<id>`, written by the seeding toast's link
   * (`FindingsPanel.tsx:34` → `/agents/<owner>?tab=evals&case=<id>`). Read from
   * the URL rather than passed down, because the URL is the only thing that
   * survives the navigation — and reading it here keeps `page.tsx`, which owns
   * `?tab=`, out of a second feature's business.
   */
  const highlightId = search.get("case");

  // Derived during render, every one of them (`react-best-practices` — Derive,
  // Don't Store). Nothing below is mirrored into state or synced by an Effect.
  const list = cases.data ?? [];
  const lastRuns = lastRunByCase(dashboard.data?.recent_runs);

  /**
   * AC-80. Read off the LIFECYCLE channel — `latest_batch.status` — so a tab
   * that never received the 202 still shows the action disabled: a reload
   * mid-batch, or a second browser tab. Reading `current` here instead would
   * leave the button live for the whole run, because `current` deliberately
   * keeps pointing at the last FINISHED batch.
   *
   * `runBatch.isPending` covers the sliver between the click and the refetch.
   */
  const batchRunning = isBatchRunning(dashboard.data?.latest_batch?.status);
  const runDisabled = batchRunning || runBatch.isPending;

  const openNewCase = () => setEditor({ evalCase: null });

  return (
    <div style={s.wrap}>
      <SectionLabel
        icon="Gauge"
        right={
          // The standalone dashboard (T-K), deep-linked to THIS agent. `/eval`
          // on its own resolves to whichever agent is first in the list, so
          // leaving the id off would send you from one agent's tab to another
          // agent's dashboard. The sidebar's registry key for the route is
          // `eval`, because `activeKeyFor` folds every `/eval*` pathname onto
          // that one key — the key is not the URL.
          <Link href={`/eval/${agent.id}`} className="mono" style={s.viewDashboard}>
            {t("evalsTab.viewDashboard")}
          </Link>
        }
      >
        {t("evalsTab.metricsTitle")}
      </SectionLabel>
      <p style={s.subtitle}>{t("evalsTab.metricsSubtitle")}</p>

      {/* The partial flag is rendered INSIDE the strip, beside the aggregates it
          qualifies and with no way to dismiss it (AC-81). Do not add a second
          one here — one fact, one badge. */}
      <EvalMetricStrip
        dashboard={dashboard.data}
        note={
          <span style={s.note}>
            <Icon.Code size={12} style={s.noteIcon} />
            {/* Not decoration: this sentence is the UI stating the criterion
                that the scorer makes zero model calls. */}
            {t("evalsTab.scoringNote")}
          </span>
        }
      />

      <div style={s.casesHeader}>
        <h2 style={s.h2}>{t("evalsTab.casesHeading")}</h2>
        {/* Both numbers come from the agent's actual set and its actual
            batches (AC-75). `trend` is the finished-batch series, capped at the
            server's TREND_LIMIT. */}
        <span style={s.summary}>
          {t("dashboard.casesSummary", {
            count: list.length,
            runs: dashboard.data?.trend.length ?? 0,
          })}
        </span>
        <div style={s.actions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            disabled={runDisabled}
            title={runDisabled ? t("evalsTab.runAllDisabled") : undefined}
            onClick={() => runBatch.mutate()}
          >
            {runDisabled ? t("evalsTab.running") : t("evalsTab.runAll")}
          </Button>
          <Button kind="primary" size="sm" icon="Plus" onClick={openNewCase}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {/* The server's own reason — 409 for a batch already running, 422 for an
          empty set — shown verbatim. A generic sentence here would hide which
          of the two happened. */}
      {runBatch.isError && (
        <div role="alert" style={s.error}>
          {runBatch.error.message}
        </div>
      )}

      {cases.isLoading ? (
        <div style={s.loading}>{t("evalsTab.loadingCases")}</div>
      ) : cases.isError ? (
        <ErrorState body={cases.error.message} onRetry={() => void cases.refetch()} />
      ) : list.length === 0 ? (
        // AC-76: the empty set says so AND invites the first case; an empty
        // list with no way forward is where this screen dead-ends.
        <EmptyState
          icon="FlaskConical"
          title={t("evalsTab.emptyCases")}
          cta={t("evalsTab.newCase")}
          onCta={openNewCase}
        />
      ) : (
        // One request, whole set, no pagination (NFR-14). The runs come from the
        // dashboard payload this tab already holds, so a 100-case set adds no
        // per-row fetch.
        <div style={s.list}>
          {list.map((evalCase) => (
            <EvalCaseRow
              key={evalCase.id}
              evalCase={evalCase}
              lastRun={lastRuns.get(evalCase.id)}
              highlighted={evalCase.id === highlightId}
              onEdit={(c) => setEditor({ evalCase: c })}
              onDelete={(c) => deleteCase.mutate({ id: c.id, agentId: agent.id })}
            />
          ))}
        </div>
      )}

      {editor && (
        <EvalCaseEditor
          agentId={agent.id}
          evalCase={editor.evalCase}
          onClose={() => setEditor(null)}
          onSaved={() => setEditor(null)}
        />
      )}
    </div>
  );
}
