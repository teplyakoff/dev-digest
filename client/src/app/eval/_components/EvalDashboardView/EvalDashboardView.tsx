/* /eval/:agentId — the standalone Eval Dashboard: pick an agent, see its eval
   metrics, run the set, compare two runs. Design:
   `screen_skillslab_evaldashboard.jsx:393-477`. */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
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
 * to a repository — so `/eval/:agentId` resolves with no repo selected.
 *
 * The agent is the `:agentId` SEGMENT, never component state. State made the
 * dashboard un-linkable: every reload landed on whichever agent happened to be
 * first, and the URL never said which one was on screen. Both entry points come
 * through here — `/eval` has no segment and `/eval/:agentId` may name an agent
 * that no longer exists, and each falls back to the first agent and then
 * `replace`s the URL, so the address bar always names what is rendered.
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

  const router = useRouter();
  // `/eval` has no dynamic segment, so `agentId` is undefined there — the same
  // view serves both routes and treats "no segment" like "unknown agent".
  // Typed as `string | string[]` by `useParams` because a catch-all segment
  // could produce an array; `:agentId` never does, and the narrowing is what
  // makes "no segment" and "some segment" one expression.
  const rawId = useParams().agentId;
  const routeId = typeof rawId === "string" ? rawId : null;

  const agents = useAgents();

  // Derived during render, never mirrored into state with an Effect
  // (`react-best-practices` — Derive, Don't Store): the agent on screen is a
  // lookup of the URL's id in the live list, and the fallback is simply "the
  // first one". Reading it back out of the list also means a renamed agent
  // re-renders with its new name.
  const list = agents.data ?? [];
  const agent = list.find((a) => a.id === routeId) ?? list[0];
  const agentId = agent?.id ?? null;

  // Caused by data arriving rather than by an interaction, so an Effect and not
  // a handler (`react-best-practices` — useEffect Rules), and the same shape as
  // `HomeRedirectView`. `replace`, not `push`: landing on `/eval` and being sent
  // to the first agent must not put a step in the history that Back returns to.
  React.useEffect(() => {
    if (agentId && agentId !== routeId) router.replace(`/eval/${agentId}`);
  }, [agentId, routeId, router]);

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
                // Picking an agent is a navigation: the dashboard it opens is
                // a place, and must survive a reload and a copied link.
                items={list.map((a) => ({
                  label: a.name,
                  icon: "Cpu" as const,
                  onClick: () => router.push(`/eval/${a.id}`),
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
