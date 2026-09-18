// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";
import { builtinAutomationStage, liveIcon, onRunStart, onStepFailed, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onBrief, onMark, progressView } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-09-17T10:00:00.000Z";

const review = stage("review", { name: "Review" });
const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr"] } };
const demo = builtinStage("demo", []);

describe("живой этап — идёт работа агента или автоматизации", () => {
  it("начатый этап навыка живой, только пока агент работает", () => {
    fc.assert(
      fc.property(fc.constantFrom("self", "agent:code-reviewer", "workflow:I-R+T"), fc.boolean(), (executor, agentActive) => {
        expect(liveIcon(review, { startedAt: T0, executor }, agentActive) !== null).toBe(agentActive);
      }),
    );
  });

  it("идущая автоматизация живая при любом агенте, упавшая — ни при каком", () => {
    const running = onRunStart(EMPTY_PROGRESS, "publish", stepsOf(publish), T0);
    const failed = onStepFailed(running, "publish", "x");
    fc.assert(
      fc.property(fc.boolean(), (agentActive) => {
        expect(liveIcon(publish, running.stages.publish!, agentActive)).toBe("automation");
        expect(liveIcon(publish, failed.stages.publish!, agentActive)).toBeNull();
      }),
    );
  });

  it("в виде прогресса этап навыка живой только при работающем агенте, по умолчанию — нет", () => {
    const started = onMark(EMPTY_PROGRESS, "review", "started", T0);
    expect(progressView(started, [review]).stages[0]).toMatchObject({ state: "now", live: false });
    expect(progressView(started, [review], true).stages[0]).toMatchObject({ state: "now", live: true });
  });

  it("этап, ждущий владельца, не живой, даже когда агент работает", () => {
    const waiting = onBrief(EMPTY_PROGRESS, { id: "dec_1", threadId: "thr_1", title: "Демо", createdAt: T0, kind: "brief", questions: [], stages: { list: [demo], minButtonWidth: 170 }, outcome: { stage: "demo", final: true, done: [], pending: [], results: [{ label: "a", target: "a" }] } }, T0);
    expect(progressView(waiting, [demo], true).stages[0]).toMatchObject({ state: "now", live: false });
  });

  it("законченные, впереди и вычеркнутые этапы не живые", () => {
    const done = onMark(onMark(EMPTY_PROGRESS, "review", "started", T0), "review", "done", T0);
    const view = progressView(done, [review, stage("code")], true);
    expect(view.stages.map((s) => s.live)).toEqual([false, false]);
  });
});
