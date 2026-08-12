import type { ApiClient } from './api/types.js';
import type { Resolver } from './resolve.js';

/**
 * Composition-root wiring, and nothing else.
 *
 * This type lives here rather than beside the port in `api/types.ts` for one
 * reason: `Deps` names `Resolver`, which is ring 2, and `api/types.ts` is ring
 * 1. onion §2 counts type-only imports, so declaring the DI bundle in the port
 * file made ring 1 depend on ring 2 — invisible at runtime (both sides erase)
 * but enough to make the ring claim in `AGENTS.md` unfalsifiable.
 *
 * The composition root is the one place allowed to point at every ring (§6),
 * so a file whose whole job is "what the graph hands to a handler" belongs
 * exactly here. `api/types.ts` now imports nothing but contract types, which is
 * what makes "ring 1 imports itself only" a thing you can check rather than a
 * thing you assert.
 */
export interface Deps {
  api: ApiClient;
  resolver: Resolver;
}
