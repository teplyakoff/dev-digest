/* CreateSkillModal — name/description/type/body, then straight into the editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { ApiError } from "../../../../../../lib/api";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { MODAL_WIDTH, TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState(t("create.defaultBody"));
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      const skill = await create.mutateAsync({ name: name.trim(), description, type, body });
      onClose();
      router.push(`/skills/${skill.id}?tab=config`);
    } catch (e) {
      // 409 (name taken) and 422 (bad shape) both carry a message written for a
      // person — show it. Anything else is ours, not theirs, so it gets the
      // generic line rather than a leaked internal string.
      const actionable = e instanceof ApiError && (e.status === 409 || e.status === 422);
      setError(actionable ? (e as ApiError).message : t("page.loadError"));
    }
  };

  const canSubmit = name.trim().length >= 2 && description.trim().length > 0 && body.trim().length > 0;

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          {error && <span style={s.error}>{error}</span>}
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending || !canSubmit}>
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label={t("config.name")} required hint={t("config.nameHint")}>
          <TextInput value={name} onChange={setName} placeholder={t("config.namePlaceholder")} mono />
        </FormField>
        <FormField label={t("config.description")} required hint={t("config.descriptionHint")}>
          <TextInput
            value={description}
            onChange={setDescription}
            placeholder={t("config.descriptionPlaceholder")}
          />
        </FormField>
        <FormField label={t("config.type")}>
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={[...TYPE_OPTIONS]} />
        </FormField>
        <FormField label={t("config.body")} required hint={t("config.bodyHint")}>
          <Textarea value={body} onChange={setBody} rows={10} mono />
        </FormField>
      </div>
    </Modal>
  );
}
