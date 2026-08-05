import { eq } from 'drizzle-orm';
import type { Db, DbTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * F1 — settings data-access. The ONLY place that touches the `settings` table.
 *
 * Non-secret preferences only. API keys and tokens never come near this table —
 * they live behind `SecretsProvider` in `~/.devdigest/secrets.json`.
 */
export class SettingsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  /** Upsert one preference. Unique on (workspace, user, key). */
  async put(
    workspaceId: string,
    userId: string,
    key: string,
    value: unknown,
    tx?: DbTx,
  ): Promise<void> {
    const invoker = tx ?? this.db;
    await invoker
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value },
      });
  }
}
