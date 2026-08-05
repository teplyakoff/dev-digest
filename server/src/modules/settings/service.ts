import type {
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SettingsRepository } from './repository.js';
import { rowsToSettings } from './helpers.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';

/**
 * F1 — settings service. Non-secret preferences, plus the connection test that
 * validates a provider key.
 *
 * The one thing worth knowing about this module: `settings` rows and secrets are
 * DIFFERENT STORAGE. Preferences go to Postgres; keys go through
 * `SecretsProvider` to `~/.devdigest/secrets.json` (mode 0600) and never touch
 * the database or git. `secretsStatus` returns booleans for exactly that reason —
 * the API has no endpoint that can read a key back out.
 */
export class SettingsService {
  private repo: SettingsRepository;

  constructor(private container: Container) {
    this.repo = new SettingsRepository(container.db);
  }

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.list(workspaceId));
  }

  /** Which provider keys are configured — booleans only, never the values. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) => [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /** Upsert a patch of preferences and return the full resulting Settings. */
  async update(workspaceId: string, userId: string, patch: SettingsUpdate): Promise<Settings> {
    const entries = Object.entries(patch);
    // One transaction: a settings PUT is one user action. Half-applying it would
    // leave, say, a feature's provider switched but its model not.
    await this.container.db.transaction(async (tx) => {
      for (const [key, value] of entries) {
        await this.repo.put(workspaceId, userId, key, value, tx);
      }
    });
    return this.get(workspaceId);
  }

  /**
   * Test a provider key with a cheap live call (`listModels` / `GET user`).
   *
   * Never throws: a failed connection test IS the answer the UI is asking for, so
   * the failure comes back as `{ ok: false, message }` with a 200. Reserve
   * thrown errors for the request being wrong, not the credential.
   */
  async testConnection(provider: ConnTestProvider, key?: string): Promise<ConnTestResult> {
    try {
      // A supplied key is persisted (BYO key) BEFORE testing, so the test
      // reflects — and the rest of the app can immediately use — the new value.
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }

      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        return { provider, ok: true, message: `Connected as @${await gh.currentLogin()}` };
      }

      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
