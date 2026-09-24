// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, isActionStage, onRunStart, onStepDone, onStepFailed, onStepStarted, pendingAction, pendingAutomation, runningIcon, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark, progressView } from "./progress";
import { stage } from "./stages-fixtures";
import { stageInstructions } from "./stages";

const T0 = "2026-09-17T10:00:00.000Z";
const T1 = "2026-09-17T10:01:00.000Z";

const publish: WorkStage = { ...actionStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr", "bb.tasks-in-review"] } };
const land: WorkStage = { ...builtinAutomationStage(["publish"]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge"] } };
const review = stage("review", { name: "Review" });
const stages = [review, publish, land];

const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);

/** Прогон дошёл до этапа Action: этап начат снимком шагов, первый шаг ждёт нажатия. */
const awaiting = (): FlowProgress => onRunStart(done(EMPTY_PROGRESS, "review"), publish.id, stepsOf(publish), T0);

const stepStates = (progress: FlowProgress) => progressView(progress, stages).stages.find((s) => s.id === publish.id)?.automation?.steps.map((s) => s.state);

describe("этап Action в ядре", () => {
  it("этап Action узнаётся по виду, автоматизация — нет", () => {
    expect(isActionStage(publish)).toBe(true);
    expect(isActionStage(land)).toBe(false);
  });

  it("цепочка автоматизаций встаёт на этапе Action", () => {
    expect(pendingAutomation(stages, done(EMPTY_PROGRESS, "review"))).toBeNull();
    expect(pendingAutomation(stages, awaiting())).toBeNull();
  });

  it("ждущий нажатия этап — первый незакрытый этап Action и номер его шага", () => {
    expect(pendingAction(stages, done(EMPTY_PROGRESS, "review"))).toEqual({ stage: publish, at: 0 });
    expect(pendingAction(stages, onStepDone(awaiting(), publish.id, T1))).toEqual({ stage: publish, at: 1 });
    expect(pendingAction(stages, EMPTY_PROGRESS)).toBeNull();
  });

  it("закрытый этап Action пускает прогон к следующей автоматизации", () => {
    const passed = stepsOf(publish).reduce((p) => onStepDone(p, publish.id, T1), awaiting());
    expect(pendingAction(stages, passed)).toBeNull();
    expect(pendingAutomation(stages, passed)?.stage.id).toBe(land.id);
  });

  it("шаг Action до нажатия ждёт, нажатый идёт, упавший показывает ошибку", () => {
    expect(stepStates(awaiting())).toEqual(["wait", "todo"]);
    expect(stepStates(onStepStarted(awaiting(), publish.id))).toEqual(["now", "todo"]);
    expect(stepStates(onStepFailed(onStepStarted(awaiting(), publish.id), publish.id, "GitHub ответил 405", "2026-09-18T10:00:00.000Z"))).toEqual(["fail", "todo"]);
    expect(stepStates(onStepDone(onStepStarted(awaiting(), publish.id), publish.id, T1))).toEqual(["done", "wait"]);
  });

  it("шаг автоматизации ждущим не бывает: её шаги идут сами", () => {
    const running = onRunStart(done(EMPTY_PROGRESS, "review"), land.id, stepsOf(land), T0);
    expect(progressView(running, stages).stages.find((s) => s.id === land.id)?.automation?.steps.map((s) => s.state)).toEqual(["now"]);
  });

  it("инструкция агенту про Action велит закончить ход и ничего не отмечать", () => {
    const text = stageInstructions(stages) ?? "";
    expect(text).toContain(`${publish.id} "Publish" — action`);
    expect(text).toMatch(/action[^\n]*owner[^\n]*button/i);
    expect(text).toMatch(/action[^\n]*end your turn/i);
  });
});

describe("этап Action и значок идущей работы", () => {
  it("ждущий нажатия этап Action живым не считается: работа стоит за владельцем", () => {
    expect(runningIcon(publish, { startedAt: T0, run: { steps: stepsOf(publish), at: 0, error: null } })).toBeNull();
  });

  it("идущий шаг Action мерцает своим значком, а не значком автоматизации", () => {
    expect(runningIcon(publish, { startedAt: T0, run: { steps: stepsOf(publish), at: 0, error: null, busy: true } })).toBe("action");
    expect(runningIcon(land, { startedAt: T0, run: { steps: stepsOf(land), at: 0, error: null } })).toBe("automation");
  });

  it("шаги, убранные из этапа по ходу прогона, не запирают нажатие: ждущий шаг берётся из снимка", () => {
    const shortened: WorkStage = { ...publish, automation: { source: "flow", steps: ["git.create-pr"] } };
    const midRun = onStepDone(awaiting(), publish.id, T1);
    expect(pendingAction([review, shortened, land], midRun)).toEqual({ stage: shortened, at: 1 });
  });
});
