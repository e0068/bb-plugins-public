// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { actionAt, builtinAutomationStage, interruptedAutomation, onRunStart, onStepDone, onStepFailed, pendingAutomation, stepsOf, wakeText } from "./automation-run";
import { EMPTY_PROGRESS, onMark } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T10:01:00.000Z";

const auto = (id: string): WorkStage => ({ ...builtinAutomationStage([]), id, name: id, automation: { source: "flow", steps: ["git.create-pr", "git.merge"] } });
const act = (id: string): WorkStage => ({ ...actionStage([]), id, name: id, automation: { source: "flow", steps: ["git.create-pr", "git.merge"] } });
const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);
const started = (progress: FlowProgress, s: WorkStage): FlowProgress => onRunStart(progress, s.id, stepsOf(s), T0);

describe("несколько этапов со шагами открыты сразу", () => {
  const p1 = act("p1");
  const p2 = act("p2");
  const stages = [stage("s1"), p1, stage("s2"), p2];

  it("начатый Action ждёт нажатия на своём шаге, даже когда раньше него наступил другой Action", () => {
    const progress = done(onStepDone(started(done(EMPTY_PROGRESS, "s2"), p2), p2.id, T1), "s1");
    expect(actionAt(stages, progress, p2.id)).toBe(1);
    expect(actionAt(stages, progress, p1.id)).toBe(0);
  });

  it("не наступивший и закрытый Action нажатия не ждут", () => {
    expect(actionAt(stages, EMPTY_PROGRESS, p2.id)).toBeNull();
    const closed = stepsOf(p2).reduce((p) => onStepDone(p, p2.id, T1), started(done(EMPTY_PROGRESS, "s2"), p2));
    expect(actionAt(stages, closed, p2.id)).toBeNull();
  });

  it("упавшая автоматизация держит новые старты, но не нажатие на уже начатый Action", () => {
    const a = auto("a");
    const flow = [stage("s1"), p1, stage("s2"), a];
    const progress = onStepFailed(started(done(started(done(EMPTY_PROGRESS, "s1"), p1), "s2"), a), a.id, "no token", T1);
    expect(actionAt(flow, progress, p1.id)).toBe(0);
    expect(actionAt([stage("s0"), a, stage("s1"), p1], onStepFailed(started(done(EMPTY_PROGRESS, "s1"), a), a.id, "x", T1), p1.id)).toBeNull();
  });

  it("прерванный прогон продолжается, даже когда раньше него наступила не начатая автоматизация", () => {
    const a1 = auto("a1");
    const a2 = auto("a2");
    const flow = [stage("s1"), a1, stage("s2"), a2];
    const progress = done(onStepDone(started(done(EMPTY_PROGRESS, "s2"), a2), a2.id, T1), "s1");
    expect(interruptedAutomation(flow, progress)).toEqual({ stage: a2, from: 1 });
    expect(pendingAutomation(flow, progress)).toEqual({ stage: a1, from: null });
    expect(interruptedAutomation(flow, done(EMPTY_PROGRESS, "s1"))).toBeNull();
  });
});

describe("реплика агенту после доигранной автоматизации", () => {
  it("называет этап, с которого продолжать", () => {
    const text = wakeText("automation", [], stage("demo-2", { name: "Demonstration" }));
    expect(text.split("\n")[0]).toBe("Flow: the automation stage is done — carry on with the next stage of the flow.");
    expect(text).toContain('Next stage: demo-2 "Demonstration".');
  });
});
