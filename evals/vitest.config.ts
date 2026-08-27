import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room. 240s was not
    // enough: on CI the tool tiers run through the LiteLLM proxy against an OpenRouter model,
    // and an agent case that dispatches a subagent hit exactly 240000ms and died as a timeout
    // rather than as a score. 480s is sized for that worst case (proxy hop + subagent + judge),
    // not for a local run on the subscription, which finishes well inside the old bound.
    testTimeout: 480_000,
    hookTimeout: 480_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
