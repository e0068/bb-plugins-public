import { describe, expect, it } from "vitest";

import { automationView, DEFAULT_RETRY, onRetryDropped, onRunRetry, onRunStart, onStepDone, onStepFailed, retryDelay, retryDueIn, retryPolicyOf } from "./automation-run";
import type { FlowProgress, WorkStage } from "../shared/contract";

const T0 = "2026-09-25T10:00:00.000Z";
const LATER = "2026-09-25T10:00:30.000Z";
const STEPS = [{ id: "git.commit", label: "Commit" }, { id: "git.merge", label: "Merge the PR" }];
const started = onRunStart({ stages: {}, waiting: [] }, "auto", STEPS, T0);
const AUTO: WorkStage = { id: "auto", kind: "skill", skill: "", name: "Auto", executors: [], automation: { source: "flow", steps: ["git.commit", "git.merge"] } };
const trackOf = (progress: FlowProgress) => progress.stages.auto;
/** Шаг упал и Flow повторил его сам `n` раз, каждый раз снова с падением. */
const retriedAuto = (n: number): FlowProgress =>
  Array.from({ length: n }).reduce<FlowProgress>((p) => onStepFailed(onRunRetry(p, "auto", true), "auto", "timeout", T0), onStepFailed(started, "auto", "timeout", T0));

describe("настройка автоповтора", () => {
  it("без полей в настройках — не повторять, три попытки", () => {
    expect(retryPolicyOf({})).toEqual(DEFAULT_RETRY);
    expect(DEFAULT_RETRY).toEqual({ seconds: 0, attempts: 3 });
  });

  it("поля настроек переходят в политику как есть, нули тоже", () => {
    expect(retryPolicyOf({ retryInSeconds: 30, retryAttempts: 0 })).toEqual({ seconds: 30, attempts: 0 });
  });
});

describe("когда повторять упавший шаг", () => {
  it("0 секунд — не повторять никогда", () => {
    expect(retryDelay({ seconds: 0, attempts: 0 }, trackOf(retriedAuto(0)))).toBeNull();
  });

  it("N секунд — повтор через N×1000 мс, пока попытки шага не кончились", () => {
    const policy = { seconds: 30, attempts: 2 };
    expect(retryDelay(policy, trackOf(retriedAuto(0)))).toBe(30_000);
    expect(retryDelay(policy, trackOf(retriedAuto(1)))).toBe(30_000);
    expect(retryDelay(policy, trackOf(retriedAuto(2)))).toBeNull();
  });

  it("0 попыток — повторять без ограничения", () => {
    expect(retryDelay({ seconds: 5, attempts: 0 }, trackOf(retriedAuto(50)))).toBe(5000);
  });

  it("повтор владельца возвращает шагу все попытки", () => {
    const manual = onStepFailed(onRunRetry(retriedAuto(2), "auto"), "auto", "timeout", T0);
    expect(retryDelay({ seconds: 30, attempts: 2 }, trackOf(manual))).toBe(30_000);
  });

  it("следующий шаг начинает со своих попыток", () => {
    const next = onStepFailed(onStepDone(onRunRetry(retriedAuto(2), "auto", true), "auto", T0), "auto", "conflict", T0);
    expect(retryDelay({ seconds: 30, attempts: 2 }, trackOf(next))).toBe(30_000);
  });
});

describe("назначенный повтор в записи прогона", () => {
  it("срок повтора лежит у упавшего прогона и виден на упавшем шаге", () => {
    const failed = onStepFailed(started, "auto", "timeout", T0, LATER);
    expect(retryDueIn(trackOf(failed), T0)).toBe(30_000);
    const steps = automationView(AUTO, trackOf(failed) ?? {}).steps;
    expect(steps.map((s) => s.retryAt)).toEqual([LATER, null]);
  });

  it("срок вышел — повтор сразу, не с отрицательной задержкой", () => {
    expect(retryDueIn(trackOf(onStepFailed(started, "auto", "timeout", T0, T0)), LATER)).toBe(0);
  });

  it("повтор, пропуск и снятие убирают срок", () => {
    const failed = onStepFailed(started, "auto", "timeout", T0, LATER);
    for (const after of [onRunRetry(failed, "auto", true), onRunRetry(failed, "auto"), onStepDone(failed, "auto", T0), onRetryDropped(failed, "auto")]) {
      expect(trackOf(after)?.run?.retryAt).toBeUndefined();
      expect(retryDueIn(trackOf(after), T0)).toBeNull();
    }
  });

  it("падение без срока — шаг ждёт владельца, повтора нет", () => {
    expect(retryDueIn(trackOf(onStepFailed(started, "auto", "timeout", T0)), T0)).toBeNull();
  });
});
