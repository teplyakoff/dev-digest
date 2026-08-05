/* PR Detail — /repos/:repoId/pulls/:number. The whole feature lives in
   _components/PrDetailView; this file only binds it to the URL. */
"use client";

import { PrDetailView } from "./_components/PrDetailView/PrDetailView";

export default function PRDetailPage() {
  return <PrDetailView />;
}
