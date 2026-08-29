/* /evals — the route this dashboard shipped on in L06, kept as a permanent
   redirect to `/eval`. The screenshots in `docs/results/l06-homework/` and any
   bookmark from that lab point here, and a 404 would break them.

   `/eval` is the canonical spelling: `activeKeyFor`
   (`src/components/app-shell/helpers.ts`) already folds every `/eval*` pathname
   onto the nav key `eval`, and the per-agent route is `/eval/:agentId`. */
import { redirect } from "next/navigation";

export default function EvalsPage() {
  redirect("/eval");
}
