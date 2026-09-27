// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, onStepFailed, pendingAction, pendingAutomation, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark } from "./progress";
import { CODE_FLOW, stage } from "./stages-fixtures";

const T0 = "2026-09-26T10:00:00.000Z";
const T1 = "2026-09-26T10:01:00.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr"] } };
const land: WorkStage = { ...builtinAutomationStage(["publish"]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge"] } };
const press: WorkStage = { ...actionStage([]), id: "press", name: "Press", automation: { source: "flow", steps: ["git.create-pr"] } };
const review = stage("review");
const implement = stage("implement");

const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);
const doneAll = (ids: readonly string[], progress: FlowProgress = EMPTY_PROGRESS): FlowProgress => ids.reduce(done, progress);
const skip = (progress: FlowProgress, id: string): FlowProgress => ({ ...progress, stages: { ...progress.stages, [id]: { ...progress.stages[id], skipped: true } } });
const runThrough = (progress: FlowProgress, s: WorkStage): FlowProgress => stepsOf(s).reduce((p) => onStepDone(p, s.id, T1), onRunStart(progress, s.id, stepsOf(s), T0));
const failed = (progress: FlowProgress, s: WorkStage): FlowProgress => onStepFailed(onRunStart(progress, s.id, stepsOf(s), T0), s.id, "no token", T1);

describe("автоматизация наступает, когда закрыт ближайший этап прогона перед ней", () => {
  it("тред thr_897e6zxubm: этапы до implement не тронуты, implement и testing закрыты — наступает автоматизация 12", () => {
    const pending = pendingAutomation(CODE_FLOW, doneAll(["implement", "testing"]));
    expect(pending).toEqual({ stage: CODE_FLOW[11], from: null });
    expect(CODE_FLOW.indexOf(pending!.stage)).toBe(11);
  });

  it("нетронутые этапы в начале flow не держат автоматизацию, открытый этап прямо перед ней держит", () => {
    expect(pendingAutomation(CODE_FLOW, onMark(done(EMPTY_PROGRESS, "implement"), "testing", "started", T0))).toBeNull();
    expect(pendingAutomation(CODE_FLOW, done(EMPTY_PROGRESS, "implement"))).toBeNull();
    expect(pendingAutomation([review, publish], EMPTY_PROGRESS)).toBeNull();
  });

  it("цепочка подряд стоящих автоматизаций идёт строго по порядку", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const chain = Array.from({ length: n }, (_, i): WorkStage => ({ ...publish, id: `a${i}` }));
        const stages = [stage("questions"), review, ...chain];
        const started: string[] = [];
        let progress = done(EMPTY_PROGRESS, "review");
        for (let next = pendingAutomation(stages, progress); next !== null; next = pendingAutomation(stages, progress)) {
          started.push(next.stage.id);
          progress = runThrough(progress, next.stage);
        }
        expect(started).toEqual(chain.map((s) => s.id));
      }),
    );
  });

  it("вычеркнутый этап перед автоматизацией пропускается — решает этап прогона перед ним", () => {
    const stages = [implement, review, publish];
    expect(pendingAutomation(stages, skip(done(EMPTY_PROGRESS, "implement"), "review"))?.stage.id).toBe("publish");
    expect(pendingAutomation(stages, skip(EMPTY_PROGRESS, "review"))).toBeNull();
    expect(pendingAutomation([review, publish], skip(EMPTY_PROGRESS, "review"))?.stage.id).toBe("publish");
  });

  it("вычеркнутый, но закрытый агентом этап считается закрытым", () => {
    expect(pendingAutomation([review, publish], done(skip(EMPTY_PROGRESS, "review"), "review"))?.stage.id).toBe("publish");
  });

  it("автоматизация без этапов перед ней наступает сразу", () => {
    expect(pendingAutomation([publish, review], EMPTY_PROGRESS)).toEqual({ stage: publish, from: null });
  });

  it("идущая автоматизация не начинается заново, а продолжается со своего шага", () => {
    const running = onRunStart(done(EMPTY_PROGRESS, "review"), "publish", stepsOf(publish), T0);
    expect(pendingAutomation([review, publish], running)).toEqual({ stage: publish, from: 0 });
  });

  it("закрытая автоматизация второй раз не наступает", () => {
    expect(pendingAutomation([review, publish], runThrough(done(EMPTY_PROGRESS, "review"), publish))).toBeNull();
  });

  it("упавшая раньше автоматизация держит и себя, и любую автоматизацию дальше", () => {
    const stages = [publish, review, land];
    const progress = done(failed(EMPTY_PROGRESS, publish), "review");
    expect(pendingAutomation(stages, progress)).toBeNull();
    expect(pendingAction([publish, review, press], progress)).toBeNull();
  });
});

describe("этап Action — по тому же правилу", () => {
  const withAction = CODE_FLOW.map((s) => (s.id === "flow-automation" ? { ...press, id: "flow-automation" } : s));

  it("закрыт этап прямо перед Action — Action ждёт нажатия, нетронутые этапы в начале не держат", () => {
    expect(pendingAction(withAction, doneAll(["implement", "testing"]))).toEqual({ stage: withAction[11], at: 0 });
  });

  it("открытый этап прямо перед Action держит его", () => {
    expect(pendingAction(withAction, done(EMPTY_PROGRESS, "implement"))).toBeNull();
  });

  it("упавший шаг Action ждёт повторного нажатия на своём шаге", () => {
    const stages = [review, press, land];
    const progress = onStepFailed(onRunStart(done(EMPTY_PROGRESS, "review"), press.id, stepsOf(press), T0), press.id, "405", T1);
    expect(pendingAction(stages, progress)).toEqual({ stage: press, at: 0 });
    expect(pendingAutomation(stages, progress)).toBeNull();
  });
});
