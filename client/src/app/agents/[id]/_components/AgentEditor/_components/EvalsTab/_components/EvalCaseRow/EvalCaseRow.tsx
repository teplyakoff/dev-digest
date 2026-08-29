/* EvalCaseRow — one eval case in the agent's set. Design: `components2.jsx:43-64`.

   Stays inside `EvalsTab/_components/` because it has exactly ONE consumer
   today (`frontend-architecture` §1 — placement by consumer count NOW, not by
   prediction). It moves to `components/evals/` the day a second feature renders
   a case list, and not before. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, IconBtn } from "@devdigest/ui";
import type { EvalCaseRecord, EvalRunRecord } from "@devdigest/shared";
import { caseStatus, recallPercent } from "../../helpers";
import {
  STATUS_ICON,
  actionsStyle,
  directionPillStyle,
  rowStyle,
  s,
  statusIconStyle,
} from "./styles";

export interface EvalCaseRowProps {
  evalCase: EvalCaseRecord;
  /**
   * The case's most recent run, or `undefined` when it has never run. Passed in
   * rather than fetched: the whole set's runs arrive on the dashboard payload
   * the tab already holds, and a per-row fetch is what NFR-14 forbids.
   */
  lastRun?: EvalRunRecord;
  /** True for the row `?case=<id>` points at — highlighted and scrolled to. */
  highlighted?: boolean;
  onEdit: (evalCase: EvalCaseRecord) => void;
  onDelete: (evalCase: EvalCaseRecord) => void;
  /**
   * Run THIS case alone. Optional, and the button appears only when it is
   * supplied — L06 ships no single-case run endpoint, so no consumer can
   * honestly wire it yet. Rendering a permanently disabled Play button instead
   * would advertise an action that does not exist.
   */
  onRun?: (evalCase: EvalCaseRecord) => void;
  /** True while this row's own run is in flight, for the tooltip. */
  isRunning?: boolean;
}

export function EvalCaseRow({
  evalCase,
  lastRun,
  highlighted = false,
  onEdit,
  onDelete,
  onRun,
  isRunning = false,
}: EvalCaseRowProps) {
  const t = useTranslations("eval");
  const [hovered, setHovered] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  // Everything below is derived during render (`react-best-practices` — Derive,
  // Don't Store). None of it is mirrored into state.
  const status = caseStatus(lastRun);
  const recall = recallPercent(lastRun);
  const mustFind = evalCase.expectation === "must_find";

  const STATUS_LABEL = {
    passed: t("evalsTab.passed"),
    failed: t("evalsTab.failed"),
    errored: t("evalsTab.errored"),
    never: t("evalsTab.neverRun"),
  } as const;

  // `recallSuffix` carries its own leading separator, and is appended ONLY when
  // there is a recall to append: an unknown metric renders nothing, never `0%`.
  const resultText =
    STATUS_LABEL[status] + (recall === null ? "" : t("evalsTab.recallSuffix", { recall }));

  /**
   * AC-83: the provenance tooltip exists ONLY while the case still points at
   * the finding it was seeded from. `source_finding_id` is `ON DELETE SET NULL`,
   * so a case whose origin finding was deleted keeps working and simply loses
   * the pointer — the design asserts provenance unconditionally, and that claim
   * would become false the moment the finding goes.
   *
   * Which sentence is chosen by the direction, because the direction IS the
   * decision it was seeded from: `must_find` ← accepted, `must_not_flag` ←
   * dismissed.
   */
  const provenance =
    evalCase.source_finding_id === null
      ? undefined
      : mustFind
        ? t("evalsTab.seededFromAccepted")
        : t("evalsTab.seededFromDismissed");

  // The deep link from the seeding toast (`?tab=evals&case=<id>`) lands on the
  // TAB; without this it would land on the tab and leave the reader to find the
  // new case by eye. jsdom implements no layout, so a test can only assert the
  // call — never the movement (`client/INSIGHTS.md`, 2026-08-08).
  React.useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center" });
  }, [highlighted]);

  const StatusGlyph = Icon[STATUS_ICON[status].icon];

  return (
    <div
      ref={ref}
      data-case-id={evalCase.id}
      style={rowStyle(highlighted, hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        style={statusIconStyle(status)}
        // Only `errored` earns an explanation: it is the state a reader is most
        // likely to mistake for a bad score rather than a failed run.
        title={status === "errored" ? t("evalsTab.erroredTooltip") : undefined}
        aria-label={STATUS_LABEL[status]}
        role="img"
      >
        <StatusGlyph size={15} />
      </span>

      <div style={s.body}>
        <div style={s.titleRow}>
          {/* The name is the button, so the row needs no click handler of its
              own and no `stopPropagation` around the action cluster. The full
              name lives in `title`: the truncation is visual only, never in the
              data. */}
          <button
            type="button"
            className="mono"
            style={s.name}
            title={evalCase.name}
            onClick={() => onEdit(evalCase)}
          >
            {evalCase.name}
          </button>
          <span style={directionPillStyle(mustFind)} title={provenance}>
            {mustFind ? t("evalsTab.mustFind") : t("evalsTab.mustNotFlag")}
          </span>
        </div>
        <div style={s.result}>{resultText}</div>
      </div>

      <div style={actionsStyle(hovered)}>
        {onRun && (
          <IconBtn
            icon="Play"
            label={isRunning ? t("evalsTab.running") : t("evalsTab.run")}
            size={26}
            onClick={() => onRun(evalCase)}
          />
        )}
        <IconBtn icon="Edit" label={t("evalsTab.edit")} size={26} onClick={() => onEdit(evalCase)} />
        <IconBtn
          icon="Trash"
          label={t("evalsTab.delete")}
          size={26}
          danger
          onClick={() => onDelete(evalCase)}
        />
      </div>
    </div>
  );
}
