/* /eval — the Eval Dashboard with no agent in the URL yet (L06, SPEC-08).
   Renders the same view as `/eval/:agentId`; the view resolves the first agent
   and replaces the URL with its id, so what is on screen is always named by the
   address bar. Page stays thin: it binds a URL to a view and holds nothing
   else (`.claude/skills/next-best-practices/nextjs.md` §4). */
import { EvalDashboardView } from "./_components/EvalDashboardView/EvalDashboardView";

export default function EvalPage() {
  return <EvalDashboardView />;
}
