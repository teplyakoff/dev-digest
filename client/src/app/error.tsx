/* Root error boundary for every route below app/layout.tsx.
   See _components/RootErrorView for what this catches and why it exists. */
"use client";

import { RootErrorView } from "./_components/RootErrorView/RootErrorView";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RootErrorView error={error} reset={reset} />;
}
