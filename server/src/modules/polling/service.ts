import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { PollingRepository } from './repository.js';

/**
 * F1 — polling service. MANUAL refresh that ONLY syncs the PR list: new and
 * updated PRs appear and `head_sha` moves. It triggers NO review — review is
 * manual and owned by A2.
 *
 * Unlike the pulls list, this path does NOT degrade when GitHub is unreachable.
 * The user pressed "refresh" and there is nothing to serve from cache that they
 * do not already have on screen, so the error surfaces.
 */
export interface PollResult {
  synced: number;
  reviewTriggered: false;
}

export class PollingService {
  private repo: PollingRepository;

  constructor(private container: Container) {
    this.repo = new PollingRepository(container.db);
  }

  async pollRepo(workspaceId: string, repoId: string): Promise<PollResult> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });

    // One transaction for the whole sync: either the list and its
    // `last_polled_at` stamp both land, or neither does. A partial sync that
    // still stamped the repo as freshly polled is the worst outcome — it looks
    // up to date and is not.
    await this.container.db.transaction(async (tx) => {
      for (const pr of pulls) {
        await this.repo.upsertPull(workspaceId, repo.id, pr, tx);
      }
      await this.repo.markPolled(repo.id, new Date(), tx);
    });

    return { synced: pulls.length, reviewTriggered: false };
  }
}
