"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ContextDoc } from "@/lib/types";
import { s } from "./styles";

/**
 * The store's documents, one row each: the name and what it costs.
 *
 * Presentational — it reads props, renders, and calls back. The data comes from
 * `ContextView`, which owns the hook.
 */
export function ContextDocList({
  docs,
  selectedId,
  onSelect,
}: {
  docs: ContextDoc[];
  selectedId: string | null;
  onSelect: (docId: string) => void;
}) {
  const t = useTranslations("context");

  return (
    <div style={s.list} role="list">
      {docs.map((doc) => (
        <button
          key={doc.id}
          type="button"
          role="listitem"
          // The accessible name carries the document's own name, so a screen
          // reader hears which document is being selected rather than "button".
          aria-label={doc.name}
          aria-current={doc.id === selectedId}
          style={s.row(doc.id === selectedId)}
          onClick={() => onSelect(doc.id)}
        >
          <Icon.FileText size={14} />
          <span style={s.name} title={doc.name}>
            {doc.name}
          </span>
          <span style={s.tokens}>{t("tokens", { count: doc.tokens })}</span>
        </button>
      ))}
    </div>
  );
}
