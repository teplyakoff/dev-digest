import type { Container } from '../../platform/container.js';
import { WorkspaceRepository } from './repository.js';

/**
 * F1 — workspace manager: where clones live, plus a summary of cloned repos.
 *
 * Thin, and allowed to be: it does one read and one shape mapping. The reason it
 * exists at all rather than the handler calling the repository directly is that
 * `cloneDir` comes from config and the DTO shape is the API's business — putting
 * both in the handler is what pulled Drizzle into transport in the first place.
 */

export interface WorkspaceRepoSummary {
  id: string;
  full_name: string;
  clone_path: string | null;
  last_polled_at: string | null;
  cloned: boolean;
}

export interface WorkspaceOverview {
  workspaceId: string;
  cloneDir: string;
  repos: WorkspaceRepoSummary[];
}

export class WorkspaceService {
  private repo: WorkspaceRepository;

  constructor(private container: Container) {
    this.repo = new WorkspaceRepository(container.db);
  }

  async overview(workspaceId: string): Promise<WorkspaceOverview> {
    const repos = await this.repo.listRepos(workspaceId);
    return {
      workspaceId,
      cloneDir: this.container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  }
}
