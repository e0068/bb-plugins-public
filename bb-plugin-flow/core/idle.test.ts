// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, idleMinutes, onIdleClose, onIdleOpen, onRunStart, stepsOf, wakeText } from "./automation-run";
import { EMPTY_PROGRESS } from "./progress";

const at = (minutes: number): string => new Date(Date.parse("2026-09-18T10:00:00.000Z") + minutes * 60_000).toISOString();

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Commit, FF to Main, PR", automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };

const track = (progress: FlowProgress, id: string) => progress.stages[id] ?? {};

describe("метки простоя этапа", () => {
  it("падение открывает интервал, повтор его закрывает и копит минуты", () => {
    const opened = onIdleOpen(EMPTY_PROGRESS, "publish", at(0));
    expect(track(opened, "publish").idleSince).toBe(at(0));
    const closed = onIdleClose(opened, "publish", at(10));
    expect(track(closed, "publish").idleSince).toBeUndefined();
    expect(idleMinutes(track(closed, "publish"))).toBe(10);
  });

  it("второе открытие не сдвигает начало простоя", () => {
    const opened = onIdleOpen(onIdleOpen(EMPTY_PROGRESS, "publish", at(0)), "publish", at(5));
    expect(track(opened, "publish").idleSince).toBe(at(0));
  });

  it("закрытие без открытого интервала ничего не меняет", () => {
    expect(onIdleClose(EMPTY_PROGRESS, "publish", at(10))).toEqual(EMPTY_PROGRESS);
    const closed = onIdleClose(onIdleOpen(EMPTY_PROGRESS, "publish", at(0)), "publish", at(10));
    expect(onIdleClose(closed, "publish", at(20))).toEqual(closed);
  });

  it("простой копится за несколько остановок этапа", () => {
    const first = onIdleClose(onIdleOpen(EMPTY_PROGRESS, "publish", at(0)), "publish", at(10));
    const second = onIdleClose(onIdleOpen(first, "publish", at(20)), "publish", at(25));
    expect(idleMinutes(track(second, "publish"))).toBe(15);
  });

  it("этап без простоя — ноль минут", () => {
    expect(idleMinutes({})).toBe(0);
  });

  it("новый прогон этапа начинает счёт простоя заново", () => {
    const stood = onIdleClose(onIdleOpen(EMPTY_PROGRESS, "publish", at(0)), "publish", at(10));
    const again = onRunStart(onIdleOpen(stood, "publish", at(12)), "publish", stepsOf(publish), at(20));
    expect(idleMinutes(track(again, "publish"))).toBe(0);
    expect(track(again, "publish").idleSince).toBeUndefined();
  });

  it("простой никогда не больше времени, прошедшего от первой остановки до последнего продолжения", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 })), { minLength: 1, maxLength: 6 }), (pauses) => {
        let progress = EMPTY_PROGRESS;
        let clock = 0;
        const from = clock;
        for (const [wait, work] of pauses) {
          progress = onIdleOpen(progress, "publish", at(clock));
          clock += wait;
          progress = onIdleClose(progress, "publish", at(clock));
          clock += work;
        }
        expect(idleMinutes(track(progress, "publish"))).toBeLessThanOrEqual(clock - from);
      }),
    );
  });
});

describe("текст реплики агенту", () => {
  it("автоматизация без простоя — одна строка продолжения", () => {
    const text = wakeText("automation");
    expect(text).toBe("Flow: the automation stage is done — carry on with the next stage of the flow.");
  });

  it("этап Action без простоя — своя строка продолжения", () => {
    expect(wakeText("action")).toBe("Flow: the action stage is done — carry on with the next stage of the flow.");
  });
});
