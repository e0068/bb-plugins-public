// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onIdleClose, onIdleOpen, onRunStart, onStepDone, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark, pendingActive, progressView } from "./progress";
import { stage } from "./stages-fixtures";

const at = (minutes: number): string => new Date(Date.parse("2026-09-18T10:00:00.000Z") + minutes * 60_000).toISOString();

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Commit, FF to Main, PR", automation: { source: "flow", steps: ["git.commit", "git.create-pr"] } };
const press: WorkStage = { ...actionStage([]), id: "press", name: "Publish", automation: { source: "flow", steps: ["bb.tasks-in-review"] } };
const code = stage("code", { name: "Реализация" });
const STAGES = [code, publish, press];

/** Прогон этапа: старт, простой в середине и успешные шаги в конце окна. */
const ran = (id: string, s: WorkStage, from: number, idle: [number, number] | null, to: number): FlowProgress => {
  const started = onRunStart(EMPTY_PROGRESS, id, stepsOf(s), at(from));
  const paused = idle === null ? started : onIdleClose(onIdleOpen(started, id, at(idle[0])), id, at(idle[1]));
  return stepsOf(s).reduce((p) => onStepDone(p, id, at(to)), paused);
};

const row = (progress: FlowProgress, id: string) => progressView(progress, STAGES).stages.find((s) => s.id === id)!;

describe("минуты этапа с шагами", () => {
  it("сломанная автоматизация: минуты — работа шагов, простой отдельным числом", () => {
    expect(row(ran("publish", publish, 0, [1, 617], 618), "publish")).toMatchObject({ minutes: 2, idleMinutes: 616, wallMinutes: 618 });
  });

  it("автоматизация без простоя показывает всё своё время", () => {
    expect(row(ran("publish", publish, 0, null, 9), "publish")).toMatchObject({ minutes: 9, idleMinutes: 0, wallMinutes: 9 });
  });

  it("этап Action: ожидание нажатия в минуты этапа не входит", () => {
    expect(row(ran("press", press, 0, [0, 40], 41), "press")).toMatchObject({ minutes: 1, idleMinutes: 40, wallMinutes: 41 });
  });

  it("активные минуты, записанные прежней версией, у этапа с шагами не читаются", () => {
    const record = ran("publish", publish, 0, [1, 617], 618);
    const withOldZero: FlowProgress = { ...record, stages: { ...record.stages, publish: { ...record.stages.publish!, activeMinutes: 0 } } };
    expect(row(withOldZero, "publish")).toMatchObject({ minutes: 2, idleMinutes: 616 });
  });

  it("этап-автоматизация, закрытый до правки, показывает своё полное время, а не ноль", () => {
    expect(row(ran("publish", publish, 0, null, 618), "publish")).toMatchObject({ minutes: 618, idleMinutes: 0 });
  });

  it("у этапа навыка простоя нет, минуты и подсказка прежние", () => {
    const skill = onMark(onMark(EMPTY_PROGRESS, "code", "started", at(0)), "code", "done", at(591), undefined, undefined, 7);
    expect(row(skill, "code")).toMatchObject({ minutes: 7, wallMinutes: 591, idleMinutes: null });
  });
});

describe("добор активных минут по логу сессии", () => {
  it("этапы с шагами в добор не идут: их мера — своя", () => {
    expect(pendingActive(ran("publish", publish, 0, [1, 617], 618))).toEqual([]);
    expect(pendingActive(ran("press", press, 0, [0, 40], 41))).toEqual([]);
  });

  it("этап навыка в добор идёт по-прежнему", () => {
    const skill = onMark(onMark(EMPTY_PROGRESS, "code", "started", at(0)), "code", "done", at(12));
    expect(pendingActive(skill)).toEqual([{ id: "code", from: Date.parse(at(0)), to: Date.parse(at(12)) }]);
  });
});
