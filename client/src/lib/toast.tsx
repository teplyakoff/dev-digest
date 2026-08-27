/* toast.tsx — A6 cross-cutting: system-level notifications.
   Error UX taxonomy: system errors → toast (here); form errors → inline;
   critical → full-screen (ErrorState fullScreen). */
"use client";

import React from "react";

type ToastKind = "success" | "error" | "info";

/**
 * A toast body is a `ReactNode`, not a string.
 *
 * WIDENING, NOT A MIGRATION: `string` is a valid `ReactNode`, so every existing
 * call site keeps working untouched. What it buys is a toast that can carry a
 * real control — SPEC-08 AC-66 asks the success notification for a link to the
 * case that was just created, and a link has to be an element. Spelling one as
 * link-shaped TEXT was the alternative and is worse than shipping nothing:
 * `client/INSIGHTS.md` records that offering a clickable affordance which does
 * not click is the bug, not the fix.
 *
 * Keep bodies to a line and a control. This is a notification, not a surface to
 * build UI on — anything larger belongs inline on the page.
 */
type ToastMessage = React.ReactNode;

interface Toast {
  id: number;
  kind: ToastKind;
  message: ToastMessage;
}

interface ToastApi {
  toast: (message: ToastMessage, kind?: ToastKind) => void;
  success: (m: ToastMessage) => void;
  error: (m: ToastMessage) => void;
  info: (m: ToastMessage) => void;
}

const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* Module-level bridge so non-React code (e.g. the React Query cache) can raise
   toasts without the hook. The mounted <ToastProvider> registers its pusher. */
type Pusher = (message: ToastMessage, kind?: ToastKind) => void;
let activePusher: Pusher | null = null;
export const notify = {
  toast: (m: ToastMessage, k?: ToastKind) => activePusher?.(m, k),
  success: (m: ToastMessage) => activePusher?.(m, "success"),
  error: (m: ToastMessage) => activePusher?.(m, "error"),
  info: (m: ToastMessage) => activePusher?.(m, "info"),
};

/* The style is a module-level constant rather than an inline object because
   `style={{…}}` is a `no-restricted-syntax` error in this package, and this file
   already carries its five baselined ones. */
const TOAST_LINK_STYLE: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 600,
  textDecoration: "underline",
  textUnderlineOffset: 2,
  whiteSpace: "nowrap",
};

/**
 * A link inside a toast body, styled for the toast surface.
 *
 * It lives here, beside the surface that owns it, so that every feature raising
 * a toast with a control gets the same one. A bare `<a>` would inherit the
 * browser's default blue, which is unreadable on both toast backgrounds.
 */
export function ToastLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} style={TOAST_LINK_STYLE}>
      {children}
    </a>
  );
}

const COLORS: Record<ToastKind, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--ok-bg, #052e1c)", border: "var(--ok)", icon: "✓" },
  error: { bg: "var(--crit-bg, #2e0a0a)", border: "var(--crit)", icon: "✕" },
  info: { bg: "var(--bg-elevated)", border: "var(--border-strong)", icon: "ℹ" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const seq = React.useRef(1);

  const push = React.useCallback((message: ToastMessage, kind: ToastKind = "info") => {
    const id = seq.current++;
    setItems((prev) => [...prev, { id, kind, message }]);
    // auto-dismiss after 4s
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
      info: (m) => push(m, "info"),
    }),
    [push],
  );

  // Expose this provider's pusher to the module-level `notify` bridge.
  React.useEffect(() => {
    activePusher = push;
    return () => {
      if (activePusher === push) activePusher = null;
    };
  }, [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 380,
        }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const c = COLORS[t.kind];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 9,
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: "var(--text-primary)",
                fontSize: 14,
                boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
                animation: "ddToastIn .16s ease-out",
              }}
            >
              <span style={{ color: c.border, fontWeight: 700 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
