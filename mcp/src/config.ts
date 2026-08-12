/**
 * Composition-root configuration. The ONLY file in this package that reads
 * `process.env` (onion §3: "config read from the environment → RC, nowhere
 * else").
 */

export interface McpConfig {
  /** Base URL of the DevDigest API. Loopback only — see `assertLoopback`. */
  apiUrl: string;
}

export const DEFAULT_API_URL = 'http://localhost:3001';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The API is `LocalNoAuthProvider` — it authenticates nobody and authorises
 * nothing, because it is only ever supposed to be reachable on the loopback
 * interface. That makes a wrong `DEVDIGEST_API_URL` an exfiltration path with
 * no check in front of it: point this at a remote host and every PR title,
 * diff-derived finding and convention snippet in the workspace is POSTed there
 * by a tool the user believes is local.
 *
 * So the allowlist is the host, not the scheme, and it is an allowlist.
 */
export function assertLoopback(url: URL): void {
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `DEVDIGEST_API_URL must point at the loopback interface (localhost, 127.0.0.1 or ::1); got "${url.hostname}". ` +
        'The DevDigest API has no authentication, so a non-local base URL would send this workspace\'s pull-request data to a third party.',
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw = env.DEVDIGEST_API_URL?.trim() || DEFAULT_API_URL;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`DEVDIGEST_API_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`DEVDIGEST_API_URL must be http(s); got "${url.protocol}"`);
  }
  assertLoopback(url);

  // Normalise away a trailing slash so every call site can write `${base}/repos`.
  return { apiUrl: url.toString().replace(/\/+$/, '') };
}
