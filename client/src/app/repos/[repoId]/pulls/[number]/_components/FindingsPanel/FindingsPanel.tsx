/* FindingsPanel — severity filter chips + hide-low-confidence + j/k navigation
   + FindingCard list, wiring the accept/dismiss action hook (A2) and the
   one-click "turn into eval case" mutation (SPEC-08 AC-65…AC-68).

   The panel owns both mutations and hands the cards callbacks, exactly as it
   already does for `useFindingAction`; the card stays presentational. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Toggle, EmptyState, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { countBySeverity } from "@/components/severity-counters";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { useCreateEvalCaseFromFinding } from "@/lib/hooks/evals";
import { notify, ToastLink } from "@/lib/toast";
import {
  ALL_SEVERITIES_ON,
  FILTERABLE_SEVERITIES,
  FOCUS_SCROLL_TIMEOUT_MS,
  KEY_TO_ACTION,
  type SevFilter,
} from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

/**
 * Where a case is read and edited: the owning agent's Evals tab, with the case
 * named so the tab can bring it forward. The owner comes off the created row,
 * so a finding card never has to know an agent id.
 */
function evalCaseHref(ownerId: string, caseId: string): string {
  return `/agents/${ownerId}?tab=evals&case=${caseId}`;
}

/** What one finding's create call left behind, per finding id. */
interface EvalCaseLinks {
  /** The case this click created. */
  created: string;
  /** A case that already existed for the same finding, if any (AC-68). */
  existing: string | null;
}

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  focusFindingId,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** `?finding=<id>` — a Smart Diff click asking for this card. It may belong to
   *  another run's panel, and it may be hidden by THIS panel's own filters. */
  focusFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const createEvalCase = useCreateEvalCaseFromFinding();
  // The ONLY place "this finding now has a case" is served from is the create
  // response — there is no route for it, and the hook deliberately does not
  // invalidate `reviews` (the payload would come back byte-identical). So the
  // responses are kept here, keyed by finding, rather than re-derived from
  // anything. Not a stored derivation: nothing else on this page knows it.
  const [evalCases, setEvalCases] = React.useState<Record<string, EvalCaseLinks>>({});
  const [hideLow, setHideLow] = React.useState(false);
  const [sevFilter, setSevFilter] = React.useState<SevFilter>(ALL_SEVERITIES_ON);
  const [focusIdx, setFocusIdx] = React.useState(0);
  // `FindingCard.defaultExpanded` feeds `useState`, so it is INITIAL state only
  // and cannot expand a card that is already mounted. The nonce can.
  const [expandNonce, setExpandNonce] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const handledRef = React.useRef<string | null>(null);

  // Chip counts reflect the review, not the current filter — a chip that hid
  // its severity still shows how many findings it is hiding.
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const shown = React.useMemo(
    () => visibleFindings(findings, { hideLow, severities: sevFilter }),
    [findings, hideLow, sevFilter],
  );

  /**
   * AC-65 — one click creates and persists. No dialog opens on this path: the
   * design showed a modal here, the course criterion is a single click, and the
   * criterion wins. `EvalCaseEditor` stays on "New eval case" and Edit.
   */
  const handleCreateEvalCase = React.useCallback(
    (findingId: string) => {
      createEvalCase.mutate(findingId, {
        onSuccess: (data) => {
          // `existing_cases` is read BEFORE the insert on the server, so it
          // holds only the cases that predate this click.
          const prior = data.existing_cases[0];
          const created = evalCaseHref(data.case.owner_id, data.case.id);
          const existing = prior ? evalCaseHref(prior.owner_id, prior.id) : null;
          setEvalCases((m) => ({ ...m, [findingId]: { created, existing } }));
          // AC-66 — the success notification carries the link itself, not a
          // sentence about one. The card keeps its own copy of the link below,
          // because this toast dismisses itself after four seconds and the
          // reader who looks away loses it.
          notify.success(
            <>
              {prior ? t("finding.existingEvalCase") : t("finding.evalCaseCreated")}{" "}
              <ToastLink href={created}>{t("finding.editEvalCase")}</ToastLink>
              {existing ? (
                <>
                  {" · "}
                  <ToastLink href={existing}>{t("finding.viewEvalCase")}</ToastLink>
                </>
              ) : null}
            </>,
          );
        },
        // AC-67 — the reason the SERVER returned, not a generic message. The
        // common one is a finding whose PR file carries no patch text, which the
        // server refuses rather than storing a case that asserts nothing;
        // `evalCaseNoDiff` is the fallback for a failure that carried no message
        // at all, not a replacement for the server's.
        onError: (err: unknown) => {
          const reason =
            err instanceof Error && err.message ? err.message : t("finding.evalCaseNoDiff");
          notify.error(`${t("finding.evalCaseFailed")} — ${reason}`);
        },
      });
    },
    [createEvalCase, t],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  /**
   * Bring the finding the URL names into view.
   *
   * The subtle part is that the target may be hidden by this panel's OWN
   * filters — a critical finding is unreachable while the Critical chip is off,
   * and a click that lands on an empty list reads as a broken feature. So:
   * un-filter first, let `shown` recompute, then focus and scroll on the next
   * pass. `handledRef` keeps the panel from re-scrolling every time the user
   * touches a chip while `?finding=` is still in the URL.
   *
   * The query is scoped to this panel's own root — one page holds one panel per
   * review run, and every one of them renders `[data-finding-id]`, so a
   * `document`-wide lookup would scroll to whichever run happened to render
   * first.
   *
   * WHEN the row exists is not something this panel can count frames for. It
   * appears when the query resolves, the accordion opens and the panel mounts —
   * measured at 791 ms after the click on a real PR, where the previous 20-frame
   * budget had already given up at ~330 ms without ever calling `scrollIntoView`.
   * So the row is not polled: this panel WATCHES ITS OWN SUBTREE and scrolls the
   * moment the row lands, however long that takes, with
   * `FOCUS_SCROLL_TIMEOUT_MS` as a give-up ceiling rather than a schedule.
   *
   * `handledRef` is still set only when the row was genuinely found and
   * scrolled. Looking once and marking the finding handled either way is what
   * silently lost the scroll to begin with: a single miss latched the guard above
   * and made it permanent for that finding, and `el?.scrollIntoView?.()` never
   * throws, so the miss had no symptom at all.
   */
  React.useEffect(() => {
    if (!focusFindingId) {
      handledRef.current = null;
      return;
    }
    if (handledRef.current === focusFindingId) return;
    // Not this run's finding — another panel on the page owns it.
    if (!findings.some((f) => f.id === focusFindingId)) return;

    const idx = shown.findIndex((f) => f.id === focusFindingId);
    if (idx === -1) {
      setSevFilter(ALL_SEVERITIES_ON);
      setHideLow(false);
      return;
    }

    // Focus + expand are state, so they belong on this pass, not in the
    // observer — a `setState` from a stray callback would land outside React's
    // commit.
    setFocusIdx(idx);
    setExpandNonce((n) => n + 1);

    const root = rootRef.current;
    // Nothing to watch and nothing found: leave `handledRef` alone so the next
    // pass tries again.
    if (!root) return;

    let observer: MutationObserver | null = null;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const stopWatching = () => {
      observer?.disconnect();
      observer = null;
      clearTimeout(giveUp);
    };

    const scrollIfPresent = () => {
      const el = root.querySelector(`[data-finding-id="${focusFindingId}"]`);
      if (!el) return false;
      stopWatching();
      // Handled only once it is genuinely scrolled: a finding whose row never
      // appeared is retried on the next pass instead of being swallowed.
      handledRef.current = focusFindingId;
      // SCROLL SYNCHRONOUSLY — never through `requestAnimationFrame`.
      //
      // rAF does not fire in a hidden or non-painting tab. Deferring both the
      // scroll AND the `handledRef` write into a frame meant a deep link opened
      // in a background tab dropped the scroll silently, with nothing left to
      // retry it: the guard was latched inside a callback that never ran.
      //
      // THE COST, TAKEN KNOWINGLY. `setExpandNonce` above lands one commit from
      // now and grows the card, so `block: "center"` measures the COLLAPSED
      // height and the opened card ends up sitting somewhat low — an offset of
      // roughly half the card's growth, on a row that IS on screen. That is
      // strictly smaller than the failure it replaces. Re-centring from the
      // observer was considered and rejected: the observer cannot distinguish
      // the expansion commit from a chip toggle, and scrolling the reader back
      // on a chip toggle is the exact behaviour `handledRef` exists to prevent
      // (pinned by FindingsPanel.test.tsx, "toggling a chip … must not scroll").
      //
      // jsdom implements no scrollIntoView; the optional call keeps this path
      // testable without a global polyfill.
      el.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return true;
    };

    // Already rendered — the ordinary case, and it must not wait for a mutation
    // that will never come.
    if (!scrollIfPresent()) {
      observer = new MutationObserver(() => {
        scrollIfPresent();
      });
      observer.observe(root, { childList: true, subtree: true });
      giveUp = setTimeout(stopWatching, FOCUS_SCROLL_TIMEOUT_MS);
    }
    // Unmount, or a new `?finding=`, tears down whatever is still live — no
    // observer and no timer outlives the effect that started it.
    return stopWatching;
  }, [focusFindingId, findings, shown]);

  return (
    <div ref={rootRef}>
      <div style={s.toolbar}>
        {/* Severity toggles (design: FindingsPanel chips row) — each chip flips
            its own severity; all start on. */}
        {FILTERABLE_SEVERITIES.map((sv) => (
          <Chip
            key={sv}
            active={sevFilter[sv]}
            onClick={() => setSevFilter((f) => ({ ...f, [sv]: !f[sv] }))}
            icon={SEV[sv].icon}
            count={counts[sv]}
            color={SEV[sv].c}
          >
            {SEV[sv].label}
          </Chip>
        ))}
        <div style={s.divider} />
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              expandNonce={f.id === focusFindingId ? expandNonce : undefined}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              onCreateEvalCase={() => handleCreateEvalCase(f.id)}
              // Scoped to the finding actually in flight — `variables` is the
              // finding id the mutation was called with, so one card's pending
              // state never disables the whole list.
              creatingEvalCase={createEvalCase.isPending && createEvalCase.variables === f.id}
              evalCaseHref={evalCases[f.id]?.created}
              existingEvalCaseHref={evalCases[f.id]?.existing}
            />
          ))
        )}
      </div>
    </div>
  );
}
