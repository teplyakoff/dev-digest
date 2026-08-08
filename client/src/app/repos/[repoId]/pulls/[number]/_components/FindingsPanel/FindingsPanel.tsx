/* FindingsPanel — severity filter chips + hide-low-confidence + j/k navigation
   + FindingCard list, wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Toggle, EmptyState, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { countBySeverity } from "@/components/severity-counters";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import {
  ALL_SEVERITIES_ON,
  FILTERABLE_SEVERITIES,
  FOCUS_SCROLL_TIMEOUT_MS,
  KEY_TO_ACTION,
  type SevFilter,
} from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

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
            />
          ))
        )}
      </div>
    </div>
  );
}
