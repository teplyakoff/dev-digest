/* EditConventionModal — correct a rule's wording or its category before it can
   become part of a skill.

   Not in the design, which has only Accept and Reject. The assignment requires
   editing a candidate, and the reason it belongs here rather than inline is that
   this text ends up verbatim in the skill body: it is worth a deliberate save,
   not a blur handler. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, Textarea } from "@devdigest/ui";
import type { ConventionCandidate, ConventionCategory } from "@devdigest/shared";
import { CATEGORY_KEYS, EDIT_MODAL_WIDTH } from "../../constants";
import { s } from "./styles";

/** The server's own bounds (`PatchBody` in `conventions/routes.ts`). */
const MIN_RULE = 10;
const MAX_RULE = 200;

export function EditConventionModal({
  candidate,
  onClose,
  onSave,
  saving,
  error,
}: {
  candidate: ConventionCandidate;
  onClose: () => void;
  onSave: (patch: { rule: string; category: ConventionCategory }) => void;
  saving?: boolean;
  error?: string | null;
}) {
  const t = useTranslations("conventions");
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(candidate.category);

  const trimmed = rule.trim();
  const tooShort = trimmed.length < MIN_RULE;
  const tooLong = trimmed.length > MAX_RULE;
  const unchanged = trimmed === candidate.rule && category === candidate.category;

  return (
    <Modal
      width={EDIT_MODAL_WIDTH}
      title={t("edit.title")}
      subtitle={t("edit.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error && (
            <span style={s.error}>{error}</span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("edit.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Check"
            disabled={saving || tooShort || tooLong || unchanged}
            onClick={() => onSave({ rule: trimmed, category })}
          >
            {saving ? t("edit.saving") : t("edit.save")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("edit.rule")} required hint={t("edit.ruleHint")}>
          <Textarea value={rule} onChange={setRule} rows={3} />
        </FormField>
        <FormField label={t("edit.category")} hint={t("edit.categoryHint")}>
          <SelectInput
            value={category}
            onChange={(v) => setCategory(v as ConventionCategory)}
            options={[...CATEGORY_KEYS]}
          />
        </FormField>
        {/* The evidence is not editable: it was mechanically verified against
            the sampled bytes, and letting it be retyped would make the snippet
            and the GitHub link it points at disagree. */}
        <FormField label={t("edit.evidence")} hint={t("edit.evidenceHint")}>
          <pre className="mono" style={s.snippet}>
            {candidate.evidence_snippet}
          </pre>
        </FormField>
      </div>
    </Modal>
  );
}
