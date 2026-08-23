"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
// Imported from the domain file, not the `hooks` barrel: frontend-architecture
// §12 forbids growing a barrel, and `lib/hooks/index.ts` is grandfathered rather
// than a pattern to extend.
import {
  useContextDoc,
  useContextDocs,
  useContextStore,
  useCreateContextDoc,
  useDeleteContextDoc,
  useSaveContextDoc,
} from "@/lib/hooks/context";
import { useRepoNotFound } from "@/lib/repo-context";
import { formatBytes, readUploadedDoc, totalsOf } from "../../helpers";
import { SKELETON_ROWS } from "../../constants";
import { ContextDocList } from "../ContextDocList/ContextDocList";
import { ContextDocViewer } from "../ContextDocViewer/ContextDocViewer";
import { ContextImportPicker } from "../ContextImportPicker/ContextImportPicker";
import { ContextTargetTab } from "../ContextTargetTab/ContextTargetTab";
import { s } from "./styles";

/**
 * The Project Context page: a repo's Markdown documents, and which agents and
 * skills carry them.
 *
 * This component owns the hooks; everything below it reads props and calls back.
 * The one exception is `ContextImportPicker`, which reads its own candidates —
 * deliberately, because a picker fed by a prop is a picker whose test proves
 * nothing about whether data ever reaches it.
 */
export function ContextView() {
  const t = useTranslations("context");
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const repoNotFound = useRepoNotFound(repoId);

  const { data: docs, isLoading, isError, refetch } = useContextDocs(repoId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [naming, setNaming] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const selected = useContextDoc(repoId, selectedId);
  const status = useContextStore(repoId);
  const create = useCreateContextDoc(repoId);
  const save = useSaveContextDoc(repoId);
  const remove = useDeleteContextDoc(repoId);

  if (repoNotFound) return <RepoNotFound />;

  const list = docs ?? [];
  // The SERVER's numbers when it has answered, the client's own sum until then.
  // `total_bytes` is a SQL `sum(octet_length(body))` — the same arithmetic the
  // store bound is enforced with — so once it arrives it is the one that should
  // be on screen rather than a second count computed from the list.
  const totals = status.data
    ? { docs: status.data.docs, bytes: status.data.total_bytes }
    : totalsOf(list);

  // An inline field rather than `window.prompt`: the prompt dialog is modal to
  // the whole browser, unstyleable, and untestable in jsdom — three reasons that
  // all point the same way for a control this central.
  const addEmpty = () => setNaming((open) => (open === null ? "" : null));

  const submitName = (e: React.FormEvent) => {
    e.preventDefault();
    const name = (naming ?? "").trim();
    if (name === "") return;
    create.mutate({ kind: "text", name, body: "" });
    setNaming(null);
  };

  const importPath = (path: string) => {
    setPicking(false);
    create.mutate({ kind: "import", path });
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    try {
      // Read in the browser and POST the text through the same JSON endpoint a
      // hand-typed document uses — which is why the server has no multipart
      // path and no binary-parse surface.
      const { name, body } = await readUploadedDoc(file);
      create.mutate({ kind: "text", name, body });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <AppShell>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div style={s.headerMain}>
            <h1 style={s.heading}>{t("title")}</h1>
            <div style={s.subtitle}>{t("subtitle")}</div>
            {/* The status line is documents and bytes. Never a chunk count and
                never an index state: chunking is a deliberate non-goal, and a
                status line reporting it would promise a feature nobody built. */}
            <div style={s.status}>
              {t("status", { docs: totals.docs, size: formatBytes(totals.bytes) })}
            </div>
          </div>
        </div>

        <div style={s.actions}>
          <Button size="sm" icon="Folder" onClick={() => setPicking((p) => !p)}>
            {t("add.import")}
          </Button>
          <Button size="sm" icon="Plus" onClick={addEmpty}>
            {t("add.new")}
          </Button>
          <Button size="sm" icon="Upload" onClick={() => fileInput.current?.click()}>
            {t("add.upload")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown"
            aria-label={t("add.upload")}
            style={s.hidden}
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </div>

        {naming !== null && (
          <form onSubmit={submitName} style={s.nameRow}>
            <input
              autoFocus
              aria-label={t("add.new")}
              placeholder="NOTES.md"
              value={naming}
              onChange={(e) => setNaming(e.target.value)}
              style={s.nameInput}
            />
            <Button size="sm" kind="primary" type="submit" disabled={naming.trim() === ""}>
              {t("add.new")}
            </Button>
          </form>
        )}

        {uploadError !== null && <ErrorState title={uploadError} />}

        {picking && <ContextImportPicker repoId={repoId} onImport={importPath} />}

        {isLoading && (
          <div>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} height={18} style={s.skeletonRow} />
            ))}
          </div>
        )}

        {/* A failed list and a genuinely empty store both produce an empty array
            and mean opposite things. Rendering the error as "nothing here yet"
            tells a person to start adding documents they may already have. */}
        {isError && <ErrorState title={t("loadError")} onRetry={() => void refetch()} />}

        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Folder"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("add.new")}
            onCta={addEmpty}
          />
        )}

        {!isLoading && !isError && list.length > 0 && (
          <>
            <div style={s.columns}>
              <ContextDocList docs={list} selectedId={selectedId} onSelect={setSelectedId} />
              {selected.data ? (
                <ContextDocViewer
                  doc={selected.data}
                  saving={save.isPending}
                  saveError={save.isError ? t("editor.loadError") : null}
                  deleting={remove.isPending}
                  onSave={(body) => save.mutate({ docId: selected.data!.id, body })}
                  onDelete={() => {
                    remove.mutate(selected.data!.id);
                    setSelectedId(null);
                  }}
                />
              ) : null}
            </div>

            <div style={s.section}>
              <div style={s.sectionTitle}>{t("targets.title")}</div>
              <ContextTargetTab docs={list} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
