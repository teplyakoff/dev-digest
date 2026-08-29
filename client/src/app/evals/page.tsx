/* /evals — the standalone Eval Dashboard (L06, SPEC-08). Page stays thin; the
   view owns the shell and the data. */
import { EvalDashboardView } from "./_components/EvalDashboardView/EvalDashboardView";

export default function EvalsPage() {
  return <EvalDashboardView />;
}
