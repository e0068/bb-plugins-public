import { describe, expect, it } from "vitest";

import { onRunRetry, onRunStart, onStepDone, onStepFailed } from "./automation-run";
import type { FlowProgress } from "../shared/contract";

const STEPS = [{ id: "git.commit", label: "Commit" }, { id: "git.merge", label: "Merge the PR" }];
const empty: FlowProgress = { stages: {}, waiting: [] };
const started = onRunStart(empty, "auto", STEPS, "2026-09-19T10:00:00.000Z");
const runOf = (progress: FlowProgress) => progress.stages.auto?.run;

describe("история падений шага", () => {
  it("падение попадает в историю вместе с шагом и временем", () => {
    const failed = onStepFailed(started, "auto", "HTTP 500", "2026-09-19T10:01:00.000Z");
    expect(runOf(failed)?.failures).toEqual([{ step: "git.commit", at: "2026-09-19T10:01:00.000Z", error: "HTTP 500" }]);
    expect(runOf(failed)?.error).toBe("HTTP 500");
  });

  it("повтор снимает ошибку, но историю не трогает", () => {
    const retried = onRunRetry(onStepFailed(started, "auto", "HTTP 500", "2026-09-19T10:01:00.000Z"), "auto");
    expect(runOf(retried)?.error).toBeNull();
    expect(runOf(retried)?.failures).toHaveLength(1);
  });

  it("падения копятся по порядку, в том числе на разных шагах", () => {
    const first = onStepFailed(started, "auto", "HTTP 500", "2026-09-19T10:01:00.000Z");
    const again = onStepFailed(onRunRetry(first, "auto"), "auto", "HTTP 502", "2026-09-19T10:02:00.000Z");
    const next = onStepFailed(onStepDone(onRunRetry(again, "auto"), "auto", "2026-09-19T10:03:00.000Z"), "auto", "conflict", "2026-09-19T10:04:00.000Z");
    expect(runOf(next)?.failures).toEqual([
      { step: "git.commit", at: "2026-09-19T10:01:00.000Z", error: "HTTP 500" },
      { step: "git.commit", at: "2026-09-19T10:02:00.000Z", error: "HTTP 502" },
      { step: "git.merge", at: "2026-09-19T10:04:00.000Z", error: "conflict" },
    ]);
  });

  it("успешный шаг историю не стирает", () => {
    const failed = onStepFailed(started, "auto", "HTTP 500", "2026-09-19T10:01:00.000Z");
    const done = onStepDone(onRunRetry(failed, "auto"), "auto", "2026-09-19T10:05:00.000Z", "committed");
    expect(runOf(done)?.failures).toHaveLength(1);
  });
});
