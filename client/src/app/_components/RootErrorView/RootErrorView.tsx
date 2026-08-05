"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";

/**
 * The app's only React error boundary.
 *
 * WHAT THIS IS NOT: the `<ErrorState />` each view already renders. That one
 * handles a FAILED QUERY — the API answered 500, or is unreachable — and the
 * view keeps working around it. This one catches a RENDER error: a component
 * threw while producing JSX. React unmounts the whole subtree for those, and
 * with no boundary anywhere in `src/app/` the subtree was the entire app. One
 * bad `undefined.map()` blanked the screen.
 *
 * `loading.tsx` and `not-found.tsx` remain deliberately absent: they cover the
 * server pass, which does almost nothing in this client-rendered app, and every
 * route already renders its own skeleton and empty state keyed off its query.
 * `error.tsx` was the odd one out — a real gap, not a matching choice.
 *
 * Note this sits INSIDE `app/layout.tsx`, so the nav shell and the intl provider
 * are still mounted. An error thrown by the layout itself would need
 * `global-error.tsx`; the layout only awaits locale and messages, so that is a
 * far narrower surface than the pages this covers.
 */
export function RootErrorView({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  const pathname = usePathname();

  // A render error is never expected. Log it so it is diagnosable from the
  // browser console rather than only visible as a screen that went blank.
  React.useEffect(() => {
    console.error("[render error]", error);
  }, [error]);

  // Navigating away from a broken route should clear the boundary. Without
  // this, React keeps the fallback mounted and the app looks stuck on every
  // route the user tries next.
  const firstPath = React.useRef(pathname);
  React.useEffect(() => {
    if (pathname !== firstPath.current) reset();
  }, [pathname, reset]);

  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <ErrorState
        fullScreen
        title={t("states.error")}
        // `error.message` is deliberately shown: this is a local-first developer
        // tool, the message comes from our own code, and hiding it would leave
        // the user with a shrug where a stack-trace-shaped hint could be.
        body={error.message || undefined}
        onRetry={reset}
      />
    </AppShell>
  );
}
