"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { EmptyState, Button, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { useRepos } from "@/lib/hooks";
import { s } from "./styles";

/**
 * The root route's view: send the user to their first repo's PR list, or to
 * onboarding when they have none.
 *
 * Lives here rather than in `page.tsx` because a page binds a URL to a view and
 * holds nothing else (nextjs.md §4) — this has a data hook, an effect and a
 * redirect decision, all of which would have to be rewritten to point the same
 * behaviour at a different URL.
 */
export function HomeRedirectView() {
  const router = useRouter();
  const { data: repos, isLoading, isError } = useRepos();
  const firstRepo = repos?.[0];

  // The redirect is caused by data arriving, not by an interaction, so it is an
  // Effect rather than a handler (react-best-practices § useEffect Rules).
  React.useEffect(() => {
    if (firstRepo) router.replace(`/repos/${firstRepo.id}/pulls`);
  }, [firstRepo, router]);

  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <PageContainer title="Welcome to DevDigest" subtitle="Local-first AI PR review">
        {isLoading ? (
          <div style={s.skeletonStack}>
            <Skeleton height={20} width={240} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : isError || !firstRepo ? (
          <EmptyState
            icon="GitBranch"
            title="No repositories yet"
            body="Add a repository to start reviewing pull requests. Set your API keys once in Settings → API Keys."
            cta="Add repository"
            onCta={() => router.push("/onboarding")}
          />
        ) : (
          // Shown only in the blink before the effect above navigates — and as
          // the fallback if it somehow doesn't.
          <div>
            <p style={s.redirectNote}>Taking you to your repository…</p>
            <Button kind="primary" onClick={() => router.push(`/repos/${firstRepo.id}/pulls`)}>
              Open {firstRepo.full_name}
            </Button>
          </div>
        )}
      </PageContainer>
    </AppShell>
  );
}
