"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, FormField, Modal, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { EvalCaseRecord, EvalCaseUpsertBody } from "@devdigest/shared";
import { useCreateEvalCase, useUpdateEvalCase } from "@/lib/hooks/evals";
import {
  deriveExpectation,
  diffLineKind,
  parseExpected,
  readPrMeta,
  stringifyExpected,
  toInputMeta,
} from "./helpers";
import { diffLineStyle, s } from "./styles";

/**
 * The eval-case editor modal. Design: `screen_cirunsevalcase.jsx:55-110`.
 *
 * Opens from EXACTLY two entry points (AC-97): "New eval case", and editing an
 * existing case. It is deliberately NOT on the one-click seed path — a finding
 * becomes a case in one request with no modal in between, which is the criterion
 * the whole feature is graded on.
 *
 * Shared (`components/evals/`) because both the agent editor's Evals tab and the
 * standalone eval dashboard open it (`frontend-architecture` §1).
 */
export interface EvalCaseEditorProps {
  /** The owning agent. Required — a new case cannot be created without one. */
  agentId: string;
  /**
   * The case to edit, or `null` / omitted for the "New eval case" entry point.
   * These two values ARE the two entry points of AC-97.
   */
  evalCase?: EvalCaseRecord | null;
  /** Close without saving — the Cancel button, the ✕, the backdrop and Escape. */
  onClose: () => void;
  /** The saved row, after a successful create or update. */
  onSaved?: (saved: EvalCaseRecord) => void;
  /**
   * Run this one case now. OPTIONAL, and the footer button appears only when it
   * is supplied together with a saved case: there is no single-case run hook in
   * `lib/hooks/evals`, so the action belongs to whoever owns one.
   */
  onRunCase?: (evalCase: EvalCaseRecord) => void;
  /** True while the consumer's `onRunCase` is in flight. */
  isRunning?: boolean;
}

const MODAL_WIDTH = 920;

/** Everything Tab can move focus onto inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function EvalCaseEditor({
  agentId,
  evalCase,
  onClose,
  onSaved,
  onRunCase,
  isRunning = false,
}: EvalCaseEditorProps) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const create = useCreateEvalCase();
  const update = useUpdateEvalCase();

  const initialMeta = readPrMeta(evalCase?.input_meta);
  const [tab, setTab] = React.useState("diff");
  const [name, setName] = React.useState(evalCase?.name ?? "");
  const [diff, setDiff] = React.useState(evalCase?.input_diff ?? "");
  const [metaTitle, setMetaTitle] = React.useState(initialMeta.title);
  const [metaBody, setMetaBody] = React.useState(initialMeta.body);
  const [expectedText, setExpectedText] = React.useState(() =>
    evalCase ? stringifyExpected(evalCase.expected_output) : "[]",
  );

  // Derived during render — never mirrored into state, never synced by an
  // Effect (`react-best-practices` — Derive, Don't Store). The validity badge
  // and the direction badge are two readings of the same parse.
  const parsed = parseExpected(expectedText);
  const expectation = deriveExpectation(parsed.value);
  const canSave = name.trim() !== "" && parsed.ok;
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;

  const rootRef = React.useRef<HTMLDivElement>(null);

  // Focus lands inside the dialog when it opens, on the first field.
  React.useEffect(() => {
    rootRef.current?.querySelector("input")?.focus();
  }, []);

  // A modal traps focus and offers an escape path (`react-best-practices` —
  // Accessibility). The vendored `Modal` primitive provides neither, and it is
  // frozen, so both live here — the escape path is Escape plus the ✕ the
  // primitive already renders.
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

  const submit = async () => {
    if (!canSave || saving) return;
    const body: EvalCaseUpsertBody = {
      owner_kind: "agent",
      owner_id: agentId,
      name: name.trim(),
      input_diff: diff,
      // Stays NULL: the design's third "Files" tab is out of scope (UX-6), so
      // nothing in this editor can produce a file list.
      input_files: null,
      input_meta: toInputMeta({ title: metaTitle, body: metaBody }),
      expected_output: parsed.value,
      expectation,
    };
    try {
      const saved = evalCase
        ? await update.mutateAsync({ id: evalCase.id, body })
        : await create.mutateAsync(body);
      onSaved?.(saved);
      onClose();
    } catch {
      // Surfaced from `saveError` below; the modal stays open with the input
      // intact so the reason can be acted on.
    }
  };

  const diffLines = diff === "" ? [] : diff.split("\n");

  return (
    <Modal
      width={MODAL_WIDTH}
      title={evalCase ? t("caseEditor.caseTitle", { name: evalCase.name }) : t("caseEditor.newCase")}
      subtitle={evalCase?.source_finding_id ? t("evalsTab.seededFrom") : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {tCommon("actions.cancel")}
          </Button>
          {onRunCase && evalCase && (
            <Button
              kind="secondary"
              icon="Play"
              onClick={() => onRunCase(evalCase)}
              disabled={isRunning}
            >
              {isRunning ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
          )}
          <Button kind="primary" icon="Check" onClick={submit} disabled={!canSave || saving}>
            {saving ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      }
    >
      <div ref={rootRef} style={s.body}>
        {/* ---- left: name + the two input tabs (AC-98) ---- */}
        <div style={s.left}>
          <div style={s.nameField}>
            <FormField label={t("caseEditor.nameLabel")} required>
              <TextInput
                value={name}
                onChange={setName}
                placeholder={t("caseEditor.namePlaceholder")}
                aria-label={t("caseEditor.nameLabel")}
                mono
              />
            </FormField>
          </div>
          <div style={s.inputLabel}>{t("caseEditor.inputLabel")}</div>
          {/* EXACTLY two tabs. The design draws a third ("Files"), the shipped
              i18n bundle has two, and the bundle wins: `input_files` has no
              editor and stays NULL (AC-98, UX-6). */}
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={tab}
            onChange={setTab}
            pad="0 16px"
          />
          <div style={s.tabPanel}>
            {tab === "diff" && (
              <div>
                <label>
                  <span style={s.srOnlyLabel}>{t("caseEditor.tabs.diff")}</span>
                  <Textarea
                    value={diff}
                    onChange={setDiff}
                    placeholder={t("caseEditor.diffPlaceholder")}
                    rows={10}
                    mono
                  />
                </label>
                {diffLines.length > 0 && (
                  <>
                    <div style={s.previewLabel}>{t("caseEditor.preview")}</div>
                    {/* Rendered as TEXT, one element per line. No
                        `dangerouslySetInnerHTML`: the stored diff comes from a
                        third-party repo and is untrusted by construction. */}
                    <pre className="mono" style={s.diffPre}>
                      {diffLines.map((line, i) => (
                        <div key={i} style={diffLineStyle(diffLineKind(line))}>
                          {line === "" ? " " : line}
                        </div>
                      ))}
                    </pre>
                  </>
                )}
              </div>
            )}
            {tab === "prMeta" && (
              <div>
                <FormField label={t("caseEditor.titleLabel")}>
                  <TextInput
                    value={metaTitle}
                    onChange={setMetaTitle}
                    placeholder={t("caseEditor.titlePlaceholder")}
                    aria-label={t("caseEditor.titleLabel")}
                  />
                </FormField>
                <FormField label={t("caseEditor.bodyLabel")}>
                  <TextInput
                    value={metaBody}
                    onChange={setMetaBody}
                    placeholder={t("caseEditor.bodyPlaceholder")}
                    aria-label={t("caseEditor.bodyLabel")}
                  />
                </FormField>
              </div>
            )}
          </div>
        </div>

        {/* ---- right: the expected output and its validity badge (AC-99) ---- */}
        <div style={s.right}>
          <div style={s.rightHeader}>
            <span style={s.rightTitle}>{t("caseEditor.expectedOutput")}</span>
            {parsed.ok ? (
              <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
                {t("caseEditor.validJson")}
              </Badge>
            ) : (
              <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
                {t("caseEditor.invalidJson")}
              </Badge>
            )}
            {/* The direction is derived from the expectation above, so it can
                never contradict it — and it is shown, so the derivation is
                never invisible. */}
            <Badge color="var(--text-secondary)">
              {expectation === "must_find" ? t("evalsTab.mustFind") : t("evalsTab.mustNotFlag")}
            </Badge>
          </div>
          <div style={s.expectedBox}>
            <label>
              <span style={s.srOnlyLabel}>{t("caseEditor.expectedOutput")}</span>
              <Textarea value={expectedText} onChange={setExpectedText} rows={16} mono />
            </label>
          </div>
          {saveError && (
            <div style={s.error} role="alert">
              {saveError.message}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
