/**
 * Job kinds — the JobRunner's vocabulary.
 *
 * These strings are a CONTRACT BETWEEN FEATURES, which is why they cannot live in
 * any one feature's `constants.ts`. `repos` enqueues an index job; `repo-intel`
 * registers the handler for it. Whichever module declared the literal first, the
 * other one has to import it — and a `../<other-feature>/constants.js` import is
 * exactly the coupling onion §11 forbids ("a sibling constant is still a sibling
 * import: duplicate the literal, or promote it to ring 1").
 *
 * This file is ring 1: it imports nothing, so nothing imports a ring outward by
 * depending on it. Both features now name the same source of truth, and a typo in
 * an enqueue no longer produces a job that is silently never handled.
 *
 * Adding a kind: declare it here, register a handler in the owning feature's
 * service, and enqueue from wherever the work starts.
 */

/** `repos` — clone a newly added repository (real `git clone`). */
export const CLONE_JOB_KIND = 'clone';

/** `repo-intel` — first index of a freshly cloned repo. Enqueued by `repos`. */
export const INDEX_JOB_KIND = 'repo-intel-index';

/** `repo-intel` — re-index after a repo refresh. Enqueued by `repos`. */
export const REFRESH_JOB_KIND = 'repo-intel-refresh';

/** `repo-intel` — manual "re-analyze": fetch from origin + incremental reindex. */
export const RESYNC_JOB_KIND = 'repo-intel-resync';
