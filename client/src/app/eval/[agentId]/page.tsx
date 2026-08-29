/* /eval/:agentId — the Eval Dashboard scoped to one agent (L06, SPEC-08).
   The agent is a route segment, not component state: a dashboard reached by
   link, reload or back button must show the agent the URL names.

   Thin by the same rule as every other page here — the view reads the segment
   with `useParams`, exactly as `SettingsView` reads `:section`. */
import { EvalDashboardView } from "../_components/EvalDashboardView/EvalDashboardView";

export default function EvalAgentPage() {
  return <EvalDashboardView />;
}
