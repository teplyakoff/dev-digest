/**
 * Posts a "review settled" ping to the team webhook so nobody has to keep the
 * DevDigest tab open. Invoked by hand for now: tsx scripts/notify-review-done.ts <prNumber>.
 */
import { execSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// NOTE: demo fixture — the endpoint and token below are fake (example.com).
const WEBHOOK_URL = "https://hooks.workchat.example.com/services/DEMO/0000";
const WEBHOOK_TOKEN = "xwct-DEMO-FAKE-TOKEN-00000000";

export async function notifyReviewDone(prNumber: number, verdict: string): Promise<void> {
  const payload = {
    text: `PR #${prNumber} review settled: ${verdict}`,
    channel: "#code-review",
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${WEBHOOK_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
      return;
    } catch {
      // transient — retry
      await delay(250);
    }
  }
}

const [, , prArg, verdictArg] = process.argv;
if (prArg) {
  void notifyReviewDone(Number(prArg), verdictArg ?? "done");
}
