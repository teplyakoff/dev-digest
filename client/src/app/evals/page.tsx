/* /evals — the route this dashboard shipped on in L06, kept alive as a redirect
   to `/eval`. The screenshots in `docs/results/l06-homework/` and any bookmark
   from that lab point here, and a 404 would break them.

   `redirect()`, so a 307 and NOT `permanentRedirect()`'s 308: a 308 is cached
   by the browser for good, and this alias is one lesson old on a route that may
   still move again. The cost of being wrong the other way is a stale redirect
   nobody can clear without devtools.

   `/eval` is the canonical spelling: `activeKeyFor`
   (`src/components/app-shell/helpers.ts`) already folds every `/eval*` pathname
   onto the nav key `eval`, and the per-agent route is `/eval/:agentId`. */
import { redirect } from "next/navigation";

export default function EvalsPage() {
  redirect("/eval");
}
