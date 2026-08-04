/* CreateSkillModal — turn the accepted conventions into one skill.

   The body it opens with is built on the SERVER from `status = 'accepted'`, and
   this modal cannot widen that set: it edits text, it does not decide
   membership. That is what keeps "a rejected candidate never reaches the skill"
   one server-side assertion instead of a client invariant nobody can test. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  FormField,
  Icon,
  Modal,
  SelectInput,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import type { ConventionSkillDraft, SkillType } from "@devdigest/shared";
import { SkillBodyEditor } from "@/components/skill-body-editor/SkillBodyEditor";
import { ApiError } from "@/lib/api";
import { useConventionSkillDraft, useCreateConventionSkill } from "@/lib/hooks/conventions";
import { CREATE_MODAL_WIDTH, SKILL_TYPE_OPTIONS } from "../../constants";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  repoFullName,
  acceptedCount,
  onClose,
}: {
  repoId: string;
  repoFullName: string | null | undefined;
  acceptedCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const { data: draft, isLoading, isError } = useConventionSkillDraft(repoId, true);
  const create = useCreateConventionSkill(repoId);

  const [edited, setEdited] = React.useState<ConventionSkillDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Seed the form from the server's draft exactly once it arrives. Keying off
  // the draft object rather than assigning during render keeps a later refetch
  // from throwing away edits in progress.
  React.useEffect(() => {
    if (draft && edited === null) setEdited(draft);
  }, [draft, edited]);

  const patch = (over: Partial<ConventionSkillDraft>) =>
    setEdited((prev) => (prev ? { ...prev, ...over } : prev));

  const submit = async () => {
    if (!edited) return;
    setError(null);
    try {
      const skill = await create.mutateAsync(edited);
      onClose();
      // Straight to the skill, because the next step — linking it to an agent
      // from the Skills tab — starts there.
      router.push(`/skills/${skill.id}?tab=config`);
    } catch (e) {
      // 409 (name taken) and 422 (nothing accepted any more) are both written
      // for a person; anything else is ours, not theirs.
      const actionable = e instanceof ApiError && (e.status === 409 || e.status === 422);
      setError(actionable ? (e as ApiError).message : t("create.failed"));
    }
  };

  const canSubmit =
    !!edited && edited.name.trim().length >= 2 && edited.body.trim().length > 0;

  return (
    <Modal
      width={CREATE_MODAL_WIDTH}
      title={t("create.title")}
      subtitle={edited?.name}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error ? (
            <span style={s.error}>{error}</span>
          ) : (
            <span style={s.footerNote}>
              <Icon.GitCommit size={13} />
              {t("create.savedAs")}
              <span className="mono" style={s.footerVersion}>
                v1
              </span>
              {t("create.addedToLab")}
            </span>
          )}
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={!canSubmit || create.isPending}
            onClick={submit}
          >
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      {isLoading && <div style={s.loading}>{t("create.loading")}</div>}
      {isError && <div style={s.loading}>{t("create.failed")}</div>}

      {edited && (
        <div style={s.body}>
          <div style={s.banner}>
            <Icon.Wrench size={15} style={s.bannerIcon} />
            <span style={s.bannerText}>
              {t.rich("create.banner", {
                count: acceptedCount,
                repo: repoFullName ?? t("page.repoFallback"),
                b: (chunks) => <b style={s.bannerStrong}>{chunks}</b>,
                repoName: (chunks) => (
                  <span className="mono" style={s.bannerRepo}>
                    {chunks}
                  </span>
                ),
              })}
            </span>
          </div>

          <FormField label={t("create.name")} required hint={t("create.nameHint")}>
            <TextInput value={edited.name} onChange={(v) => patch({ name: v })} mono />
          </FormField>
          <FormField label={t("create.description")}>
            <TextInput value={edited.description} onChange={(v) => patch({ description: v })} />
          </FormField>

          <div style={s.splitRow}>
            <div style={s.splitCell}>
              <FormField label={t("create.type")}>
                <SelectInput
                  value={edited.type}
                  onChange={(v) => patch({ type: v as SkillType })}
                  options={[...SKILL_TYPE_OPTIONS]}
                />
              </FormField>
            </div>
            <div style={s.splitCell}>
              <FormField label={t("create.enabled")} hint={t("create.enabledHint")}>
                <div style={s.toggleCell}>
                  <Toggle
                    on={edited.enabled}
                    onChange={() => patch({ enabled: !edited.enabled })}
                    size={17}
                  />
                </div>
              </FormField>
            </div>
          </div>

          <FormField label={t("create.body")} required hint={t("create.bodyHint")}>
            <SkillBodyEditor
              value={edited.body}
              onChange={(v) => patch({ body: v })}
              rows={16}
              ariaLabel={t("create.body")}
            />
          </FormField>
        </div>
      )}
    </Modal>
  );
}
