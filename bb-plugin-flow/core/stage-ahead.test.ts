import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { returnedNote } from "./mark-report";
import { isAhead, toggleStageInRun } from "./progress";
import { stage } from "./stages-fixtures";

const AT = "2026-10-01T10:00:00.000Z";
const stages = [stage("questions"), stage("plan"), stage("code"), stage("review"), stage("demo")];
/** Бриф убрал план, агент закрыл вопросы и идёт на коде. */
const running: FlowProgress = { stages: { questions: { startedAt: AT, finishedAt: AT }, plan: { skipped: true }, code: { startedAt: AT } }, waiting: [] };

describe("переключать можно только этапы впереди прогона", () => {
  it("этап после последнего тронутого — впереди", () => {
    expect(isAhead(running, stages, "review")).toBe(true);
    expect(isAhead(running, stages, "demo")).toBe(true);
  });

  it("убранный этап позади идущего — не впереди: агент его уже миновал", () => {
    expect(isAhead(running, stages, "plan")).toBe(false);
    expect(toggleStageInRun(running, stages, "plan", true)).toBe(running);
  });

  it("ждущий владельца этап — тоже позиция прогона", () => {
    const waiting: FlowProgress = { ...running, waiting: ["review"] };
    expect(isAhead(waiting, stages, "review")).toBe(false);
    expect(isAhead(waiting, stages, "demo")).toBe(true);
  });

  it("этапа нет во flow — не впереди", () => {
    expect(isAhead(running, stages, "gone")).toBe(false);
  });

  it("возвращённый этап помечен возвращённым владельцем, снятый — нет", () => {
    const off = toggleStageInRun(running, stages, "review", false);
    expect(off.stages.review?.skipped).toBe(true);
    expect(off.returned ?? []).toEqual([]);
    const back = toggleStageInRun(off, stages, "review", true);
    expect(back.stages.review?.skipped).toBe(false);
    expect(back.returned).toEqual(["review"]);
    expect(toggleStageInRun(back, stages, "review", false).returned).toEqual([]);
  });
});

describe("агент узнаёт о возвращённом этапе из ответа flow_stage", () => {
  it("следующий этап прогона возвращён владельцем — ответ называет его", () => {
    const back = toggleStageInRun(toggleStageInRun(running, stages, "review", false), stages, "review", true);
    const closed: FlowProgress = { ...back, stages: { ...back.stages, code: { startedAt: AT, finishedAt: AT } } };
    expect(returnedNote(stages, closed, "code")).toContain('The owner put stage review "review" back into the run');
  });

  it("следующий этап из брифа — ответ молчит", () => {
    const closed: FlowProgress = { ...running, stages: { ...running.stages, code: { startedAt: AT, finishedAt: AT } } };
    expect(returnedNote(stages, closed, "code")).toBe("");
  });
});
