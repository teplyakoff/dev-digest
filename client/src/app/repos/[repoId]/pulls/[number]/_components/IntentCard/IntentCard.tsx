"use client";

import { useTranslations } from "next-intl";
import { Badge, Button, Card, Icon, SectionLabel } from "@devdigest/ui";
import type { PrIntentRecord } from "@devdigest/shared";
import { s } from "./styles";

/**
 * The derived-intent card, shown above the review results on `?tab=findings`.
 *
 * PURELY PRESENTATIONAL: props in, JSX out. No hooks beyond `useTranslations`,
 * no fetching, no derived state. `FindingsTab` owns `usePrIntent` /
 * `useDeriveIntent` and hands the results down, which is also what lets a test
 * render this from mocked API data through the view rather than from a
 * hand-passed prop.
 *
 * The provenance footer is not in the design bundle — the mock carries
 * `{intent, in_scope, out_of_scope}` and nothing else. It is here anyway,
 * because the requirement it serves ("an unreachable link must not be silently
 * replaced by invention") has no other carrier: without a visible
 * missing-context line, a thin derivation and a well-sourced one look identical.
 *
 * Contract import is TYPE-ONLY. A value import from `@devdigest/shared` drags
 * the whole `export *` barrel plus `zod` into the shared chunk — ~15 kB First
 * Load JS on every route, measured.
 */

interface IntentCardProps {
  /** `null` = never derived. Undefined while the query is in flight. */
  intent: PrIntentRecord | null | undefined;
  /** The PR's current head; a mismatch means the card is showing stale intent. */
  headSha?: string | null;
  onDerive: () => void;
  deriving?: boolean;
}

export function IntentCard({ intent, headSha, onDerive, deriving }: IntentCardProps) {
  const t = useTranslations("prReview");

  if (intent == null) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Target">{t("intent.heading")}</SectionLabel>
        <div style={s.emptyState}>
          <span style={s.emptyText}>{t("intent.none")}</span>
          <Button kind="secondary" size="sm" icon="Sparkles" loading={deriving} onClick={onDerive}>
            {t("intent.derive")}
          </Button>
        </div>
      </Card>
    );
  }

  // Derived during render from the props, never stored in state.
  const stale = Boolean(headSha) && intent.head_sha !== headSha;
  const usedSources = intent.sources.filter((src) => src.status === "used");

  return (
    <Card style={s.wrap}>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.headerActions}>
            {intent.confidence === "low" && (
              <Badge color="var(--warn)" bg="transparent" icon="AlertTriangle">
                {t("intent.lowConfidence")}
              </Badge>
            )}
            {stale && (
              <Badge color="var(--text-muted)" bg="transparent">
                {t("intent.stale")}
              </Badge>
            )}
            <Button kind="ghost" size="sm" icon="RefreshCw" loading={deriving} onClick={onDerive}>
              {t("intent.rederive")}
            </Button>
          </div>
        }
      >
        {t("intent.heading")}
      </SectionLabel>

      <p style={s.summary}>{intent.summary}</p>

      <div style={s.grid}>
        <div>
          <div style={s.colLabel}>
            <Icon.Check size={12} style={s.okIcon} />
            {t("intent.inScope")}
          </div>
          {intent.in_scope.length > 0 ? (
            <ul style={s.list}>
              {intent.in_scope.map((item) => (
                <li key={item} style={s.item}>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <span style={s.empty}>{t("intent.nothingInScope")}</span>
          )}
        </div>
        <div>
          <div style={s.colLabel}>
            <Icon.X size={12} style={s.mutedIcon} />
            {t("intent.outOfScope")}
          </div>
          {intent.out_of_scope.length > 0 ? (
            <ul style={s.list}>
              {intent.out_of_scope.map((item) => (
                <li key={item} style={s.item}>
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <span style={s.empty}>{t("intent.nothingOutOfScope")}</span>
          )}
        </div>
      </div>

      <div style={s.footer}>
        <span style={s.provenance}>
          {t("intent.derivedBy", {
            model: `${intent.provider}/${intent.model}`,
            sources:
              usedSources.length > 0
                ? usedSources.map((src) => `${src.kind} ${src.ref}`).join(", ")
                : t("intent.noSources"),
          })}
        </span>
        {intent.missing_context.length > 0 && (
          <span style={s.missing}>
            <Icon.AlertTriangle size={13} style={s.missingIcon} />
            {t("intent.missing", { items: intent.missing_context.join("; ") })}
          </span>
        )}
      </div>
    </Card>
  );
}
