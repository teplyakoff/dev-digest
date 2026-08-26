import { describeWorkflow, runWorkflowCases } from "../src/index.js";
import { cases } from "./claude-md-routing.cases.js";

describeWorkflow("claude-md-routing", () => runWorkflowCases(cases));
