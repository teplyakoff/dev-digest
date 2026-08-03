/**
 * Bootstrap identity — the single workspace and user the local, no-login MVP
 * runs as.
 *
 * These live here rather than in `seed.ts` because two very different things
 * need them: the seed script CREATES those rows, and `LocalNoAuthProvider`
 * RESOLVES them on every request to scope the tenant. That made the auth adapter
 * import a script whose module body exists to write demo data — a dependency
 * nothing about authentication justifies (onion §14).
 *
 * A plain constants module imports nothing, so both sides can name it without
 * either one dragging the other along.
 */

/** Name of the workspace every request is scoped to in no-login mode. */
export const DEFAULT_WORKSPACE_NAME = 'default';

/** Email identifying the single local user. */
export const SYSTEM_USER_EMAIL = 'you@local';
