/* /evals — the standalone Eval Dashboard: pick an agent, see its eval metrics,
   run the set, compare two runs. Design: `screen_skillslab_evaldashboard.jsx:393-477`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { EvalDashboard } from "@/components/evals/EvalDashboard/EvalDashboard";
import { useAgents } from "@/lib/hooks/agents";
import { useEvalBatches, useEvalDashboard, useRunEvalBatch } from "@/lib/hooks/evals";
import { s } from "./styles";

/**
 * The route's view: it owns `AppShell`, the agent picker and the three queries
 * the page is built from — the agent list, the dashboard aggregate and the batch
 * history — and hands them to the shared `EvalDashboard`.
 *
 * The route carries NO `:repoId` — an agent's eval set belongs to the agent, not
 * to a repository — so `/evals` resolves with no repo selected.
 *
 * AC-80 is read from `latest_batch`, the LIFECYCLE channel, and not from the
 * mutation's own pending flag: a tab that never received the 202 (a reload, or a
 * second browser tab) must still keep the run action disabled while a batch is
 * in flight. `current` is the other channel and stays on the last FINISHED
 * batch, so the numbers do not collapse to dashes for the length of a run.
 */
export function EvalDashboardView() {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");

  const agents = useAgents();
  const [pickedId, setPickedId] = React.useState<string | null>(null);

  // Derived during render, never mirrored into state with an Effect
  // (`react-best-practices` — Derive, Don't Store): the picked agent is a
  // lookup in the live list, and the default is simply "the first one" until
  // somebody picks. Reading it back out of the list also means a renamed agent
  // re-renders with its new name.
  const list = agents.data ?? [];
  const agent = list.find((a) => a.id === pickedId) ?? list[0];
  const agentId = agent?.id ?? null;

  const dashboard = useEvalDashboard(agentId);
  // The batch history the runs table selects from — newest first, handed
  // through UNSORTED: its order is what breaks a `started_at` tie when a pair
  // is put in `(older, newer)` order.
  const batches = useEvalBatches(agentId);
  const run = useRunEvalBatch(agentId);

  const running = dashboard.data?.latest_batch?.status === "running";
  const casesTotal = dashboard.data?.cases_total ?? 0;
  const rows = batches.data ?? [];

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  if (agents.isError) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState
            title={tCommon("states.error")}
            body={agents.error.message}
            onRetry={() => void agents.refetch()}
          />
        </div>
      </AppShell>
    );
  }

  if (!agents.isLoading && list.length === 0) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="Cpu" title={tCommon("states.empty")} body={t("dashboard.noRuns")} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {agent?.name ?? t("dashboard.defaultTitle")}
              {agent && (
                <span className="mono" style={s.model}>
                  {agent.model}
                </span>
              )}
            </h1>
            <p style={s.subtitle}>
              {t("dashboard.casesSummary", {
                count: casesTotal,
                // The batch HISTORY, not the trend: `trend` counts only
                // finished batches, so a run in flight would go uncounted in
                // the very sentence describing it.
                runs: rows.length,
              })}
            </p>
          </div>
          <div style={s.actions}>
            {list.length > 1 && (
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="secondary" size="sm" icon="Cpu" iconRight="ChevronDown">
                    {agent?.name ?? ""}
                  </Button>
                }
                items={list.map((a) => ({
                  label: a.name,
                  icon: "Cpu" as const,
                  onClick: () => setPickedId(a.id),
                }))}
              />
            )}
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              // AC-80: disabled while a batch is in flight, whichever tab
              // started it. `casesTotal === 0` is the 422 the server would
              // answer with — there is nothing to run.
              disabled={running || run.isPending || casesTotal === 0}
              loading={running || run.isPending}
              onClick={() => run.mutate()}
            >
              {running || run.isPending
                ? t("dashboard.running")
                : t("dashboard.runEval", { count: casesTotal })}
            </Button>
          </div>
        </div>

        {/* A failed history fetch must not read as "no runs yet" — the table
            would show an empty state that asserts something the server never
            said. */}
        {(run.error || batches.error) && (
          <div style={s.error} role="alert">
            {(run.error ?? batches.error)?.message}
          </div>
        )}

        {dashboard.isError ? (
          <ErrorState
            title={tCommon("states.error")}
            body={dashboard.error.message}
            onRetry={() => void dashboard.refetch()}
          />
        ) : (
          <EvalDashboard
            dashboard={dashboard.data}
            isLoading={dashboard.isLoading || batches.isLoading || agents.isLoading}
            batches={rows}
          />
        )}
      </div>
    </AppShell>
  );
}
