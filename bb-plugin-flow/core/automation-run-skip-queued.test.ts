// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { automationView, onRunRetry, onRunStart, onSkipQueued, onStepDone, onStepFailed, queuedSkips, retryDelay, skipQueueable, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS } from "./progress";

// «Пропустить», нажатый, пока идёт попытка автоповтора, не отказывает: пропуск
// запоминается в записи прогона и применяется, когда попытка упадёт.

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:00:30.000Z";
const POLICY = { seconds: 30, attempts: 10 };

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "Land", executors: [], automation: { source: "flow", steps: ["git.merge", "bb.archive"] } };

/** Шаг упал, Flow назначил повтор и начал попытку: ошибка снята, шаг идёт. */
const retrying = (): FlowProgress => onRunRetry(onStepFailed(onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0), "land", "not mergeable", T0, T1), "land", true);

describe("пропуск во время попытки автоповтора", () => {
  it("запомненный пропуск виден на идущем шаге и снимает назначенный повтор", () => {
    const failed = onStepFailed(onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0), "land", "not mergeable", T0, T1);
    const queued = onSkipQueued(failed, "land");
    expect(queued.stages.land?.run?.retryAt).toBeUndefined();
    expect(automationView(land, onSkipQueued(retrying(), "land").stages.land!).steps.map((s) => [s.state, s.skipQueued])).toEqual([
      ["now", true],
      ["todo", false],
    ]);
  });

  it("попытка упала — автоповтора больше нет, и этап в списке пропусков к применению", () => {
    const failedAgain = onStepFailed(onSkipQueued(retrying(), "land"), "land", "not mergeable", T1);
    expect(retryDelay(POLICY, failedAgain.stages.land)).toBeNull();
    expect(queuedSkips(failedAgain)).toEqual(["land"]);
  });

  it("попытка идёт — применять пока нечего", () => {
    expect(queuedSkips(onSkipQueued(retrying(), "land"))).toEqual([]);
  });

  it("попытка прошла — пропуск забыт, следующий шаг его не наследует", () => {
    const passed = onStepDone(onSkipQueued(retrying(), "land"), "land", T1);
    expect(passed.stages.land?.run?.skipQueued).toBeUndefined();
    expect(automationView(land, passed.stages.land!).steps.map((s) => s.skipQueued)).toEqual([false, false]);
  });

  it("запомнить пропуск можно у упавшего шага и у идущей попытки автоповтора, но не у шага, который ещё не падал", () => {
    const started = onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0);
    const failed = onStepFailed(started, "land", "not mergeable", T0, T1);
    const manualRetry = onRunRetry(failed, "land");
    const nextStep = onStepDone(retrying(), "land", T1);
    expect([started, failed, retrying(), manualRetry, nextStep].map((p) => skipQueueable(p.stages.land ?? {}))).toEqual([false, true, true, false, false]);
  });

  it("этап без прогона или закрытый не меняется", () => {
    expect(onSkipQueued(EMPTY_PROGRESS, "land")).toEqual(EMPTY_PROGRESS);
    const closed = onStepDone(onStepDone(onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0), "land", T1), "land", T1);
    expect(onSkipQueued(closed, "land")).toEqual(closed);
  });
});
