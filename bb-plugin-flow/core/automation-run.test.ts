// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { automationStage, builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import {
  automationInstruction,
  automationView,
  builtinAutomationStage,
  failedAutomations,
  nextAutomation,
  onRunRetry,
  onRunStart,
  onStepDone,
  onStepFailed,
  pendingAutomation,
  runningIcon,
  stepsOf,
} from "./automation-run";
import { EMPTY_PROGRESS, onMark, progressView } from "./progress";
import { stage } from "./stages-fixtures";
import { stageInstructions } from "./stages";

const T0 = "2026-09-17T10:00:00.000Z";
const T1 = "2026-09-17T10:01:00.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Publish", automation: { source: "flow", steps: ["git.create-pr", "bb.tasks-in-review"] } };
const land: WorkStage = { ...builtinAutomationStage(["publish"]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge", "bb.archive"] } };
const external: WorkStage = automationStage({ id: "release", name: "Release" });
const review = stage("review", { name: "Review" });

const done = (progress: FlowProgress, id: string): FlowProgress => onMark(onMark(progress, id, "started", T0), id, "done", T1);

/** Прогоняет этап до конца: старт и успешный каждый шаг. */
const runThrough = (progress: FlowProgress, s: WorkStage): FlowProgress =>
  stepsOf(s).reduce((p) => onStepDone(p, s.id, T1), onRunStart(progress, s.id, stepsOf(s), T0));

describe("какую автоматизацию запускать", () => {
  it("цепочка автоматизаций запускается строго по порядку этапов", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const chain = Array.from({ length: n }, (_, i): WorkStage => ({ ...publish, id: `a${i}` }));
        const stages = [review, ...chain];
        const started: string[] = [];
        let progress = done(EMPTY_PROGRESS, "review");
        for (let next = nextAutomation(stages, progress); next !== null; next = nextAutomation(stages, progress)) {
          started.push(next.id);
          progress = runThrough(progress, next);
        }
        expect(started).toEqual(chain.map((s) => s.id));
      }),
    );
  });

  it("незавершённый этап навыка впереди не даёт запустить автоматизацию за ним", () => {
    expect(nextAutomation([review, publish], EMPTY_PROGRESS)).toBeNull();
    expect(nextAutomation([review, publish], onMark(EMPTY_PROGRESS, "review", "started", T0))).toBeNull();
  });

  it("вычеркнутый этап пропускается", () => {
    const skipped: FlowProgress = { ...EMPTY_PROGRESS, stages: { review: { skipped: true } } };
    expect(nextAutomation([review, publish], skipped)?.id).toBe("publish");
  });

  it("идущая автоматизация не запускается второй раз", () => {
    const running = onRunStart(done(EMPTY_PROGRESS, "review"), "publish", stepsOf(publish), T0);
    expect(nextAutomation([review, publish], running)).toBeNull();
  });

  it("упавший шаг не даёт запустить ни этот, ни следующий этап", () => {
    const failed = onStepFailed(onRunStart(done(EMPTY_PROGRESS, "review"), "publish", stepsOf(publish), T0), "publish", "no token", T1);
    expect(nextAutomation([review, publish, land], failed)).toBeNull();
    expect(failedAutomations(failed)).toEqual(["publish"]);
  });
});

describe("шаги в прогрессе", () => {
  it("последний успешный шаг завершает этап, промежуточный — нет", () => {
    const started = onRunStart(EMPTY_PROGRESS, "publish", stepsOf(publish), T0);
    const one = onStepDone(started, "publish", T1);
    expect(one.stages.publish?.finishedAt).toBeUndefined();
    expect(onStepDone(one, "publish", T1).stages.publish?.finishedAt).toBe(T1);
  });

  it("автоматизация без шагов завершается сразу на старте", () => {
    expect(onRunStart(EMPTY_PROGRESS, "empty", [], T0).stages.empty?.finishedAt).toBe(T0);
  });

  it("повтор возвращает этап к упавшему шагу", () => {
    const failed = onStepFailed(onStepDone(onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0), "land", T1), "land", "busy", T1);
    const retried = onRunRetry(failed, "land");
    expect(retried.stages.land?.run).toMatchObject({ steps: stepsOf(land), at: 1, error: null });
    expect(failedAutomations(retried)).toEqual([]);
  });

  it("автоматизация Automations исполняется одним шагом с её именем", () => {
    expect(stepsOf(external)).toEqual([{ id: "release", label: "Release" }]);
  });
});

describe("вид автоматизации в полосе", () => {
  it("шаги показывают сделанный, упавший с ошибкой и впереди, этап — упавший", () => {
    const failed = onStepFailed(onStepDone(onRunStart(done(EMPTY_PROGRESS, "review"), "land", stepsOf(land), T0), "land", T1), "land", "not mergeable", T1);
    const view = progressView(failed, [review, land]).stages[1]!;
    expect(view.state).toBe("fail");
    expect(view.automation?.steps.map((s) => [s.id, s.state, s.error])).toEqual([
      ["git.merge", "done", null],
      ["bb.archive", "fail", "not mergeable"],
    ]);
  });

  it("у этапа навыка поля автоматизации нет", () => {
    expect(progressView(EMPTY_PROGRESS, [review]).stages[0]).not.toHaveProperty("automation");
  });

  it("неначатая автоматизация показывает все шаги впереди", () => {
    expect(progressView(EMPTY_PROGRESS, [publish]).stages[0]?.automation?.steps.map((s) => s.state)).toEqual(["todo", "todo"]);
  });
});

describe("значок идущего этапа", () => {
  it("идущая автоматизация — молния, упавшая и законченная — без значка", () => {
    const running = onRunStart(EMPTY_PROGRESS, "publish", stepsOf(publish), T0);
    expect(runningIcon(publish, running.stages.publish!)).toBe("automation");
    expect(runningIcon(publish, onStepFailed(running, "publish", "x", T1).stages.publish!)).toBeNull();
    expect(runningIcon(publish, runThrough(EMPTY_PROGRESS, publish).stages.publish!)).toBeNull();
  });

  it("начатый этап навыка — значок его исполнителя", () => {
    expect(runningIcon(review, { startedAt: T0 })).toBe("self");
    expect(runningIcon(review, { startedAt: T0, executor: "agent:code-reviewer" })).toBe("agent");
    expect(runningIcon(review, { startedAt: T0, executor: "workflow:I-R+T" })).toBe("workflow");
    expect(runningIcon(review, {})).toBeNull();
  });
});

describe("инструкция агенту", () => {
  it("инструкция этапа-автоматизации велит закончить ход и не звать инструмент", () => {
    const line = automationInstruction(publish, 1);
    expect(line).toContain('2. publish "Publish"');
    expect(line).toContain("Flow runs");
    expect(line).toContain("end your turn");
    expect(line).not.toContain("run_automation");
  });

  it("строки этапов-автоматизаций в инструкциях flow берутся из неё", () => {
    const text = stageInstructions([builtinStage("questions", []), external]);
    expect(text?.split("\n")[2]).toBe(automationInstruction(external, 1));
  });
});

describe("незаконченный прогон после перезапуска", () => {
  it("ненаступивший этап запускается с начала, прерванный без ошибки — продолжается со своего шага, упавший — ждёт", () => {
    const base = done(EMPTY_PROGRESS, "review");
    expect(pendingAutomation([review, land], base)).toEqual({ stage: land, from: null });
    const interrupted = onStepDone(onRunStart(base, "land", stepsOf(land), T0), "land", T1);
    expect(pendingAutomation([review, land], interrupted)).toEqual({ stage: land, from: 1 });
    expect(pendingAutomation([review, land], onStepFailed(interrupted, "land", "x", T1))).toBeNull();
    expect(pendingAutomation([review, land], EMPTY_PROGRESS)).toBeNull();
  });
});

describe("что шаг сделал", () => {
  // Исполнитель выбрасывал строку успеха шага, и у сделанной автоматизации
  // в раскрытом списке не было видно ни адреса PR, ни темы коммита.
  it("строка успеха шага доезжает от прогона до вида", () => {
    const started = onRunStart(EMPTY_PROGRESS, "publish", stepsOf(publish), T0);
    const withDetail = onStepDone(started, "publish", T1, "https://github.com/o/r/pull/7");
    const [first] = automationView(publish, withDetail.stages.publish!).steps;
    expect(first).toMatchObject({ id: "git.create-pr", state: "done", detail: "https://github.com/o/r/pull/7" });
  });

  it("шаг без строки успеха остаётся без неё", () => {
    const started = onRunStart(EMPTY_PROGRESS, "publish", stepsOf(publish), T0);
    const [first] = automationView(publish, onStepDone(started, "publish", T1).stages.publish!).steps;
    expect(first).toMatchObject({ state: "done", detail: null });
  });
});
