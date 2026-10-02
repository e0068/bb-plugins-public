// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, progressView, toggleStageInRun } from "./progress";

const AT = "2026-10-02T10:00:00.000Z";
const stage = (id: string, parent?: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...(parent === undefined ? {} : { parent }) });

// Демонстрация со связкой: Preview до неё, Restore после.
const STAGES = [stage("ship"), stage("preview", "demo"), stage("demo"), stage("restore", "demo"), stage("merge")];
const skipped = (progress: FlowProgress) => STAGES.map((s) => s.id).filter((id) => progress.stages[id]?.skipped === true);

describe("одна галочка на связку в прогоне", () => {
  it("снятый владелец уносит из прогона связку, возвращённый — возвращает", () => {
    const off = toggleStageInRun(EMPTY_PROGRESS, STAGES, "demo", false);
    expect(skipped(off)).toEqual(["preview", "demo", "restore"]);
    const on = toggleStageInRun(off, STAGES, "demo", true);
    expect(skipped(on)).toEqual([]);
    expect(on.returned).toEqual(["demo", "preview", "restore"]);
  });

  it("снятый под-этап уходит один, возвращённый возвращает и владельца", () => {
    expect(skipped(toggleStageInRun(EMPTY_PROGRESS, STAGES, "restore", false))).toEqual(["restore"]);
    const off = toggleStageInRun(EMPTY_PROGRESS, STAGES, "demo", false);
    expect(skipped(toggleStageInRun(off, STAGES, "restore", true))).toEqual(["preview"]);
  });

  it("пройденный под-этап галочка владельца не трогает", () => {
    const reached: FlowProgress = { stages: { ship: { startedAt: AT, finishedAt: AT }, preview: { startedAt: AT, finishedAt: AT } }, waiting: [] };
    expect(skipped(toggleStageInRun(reached, STAGES, "demo", false))).toEqual(["demo", "restore"]);
  });
});

describe("строки полосы с под-этапами", () => {
  it("номер и счёт — по этапам верхнего уровня, под-этап несёт владельца", () => {
    const view = progressView(EMPTY_PROGRESS, STAGES);
    expect(view.stages.map((s) => [s.id, s.number, s.parent ?? null])).toEqual([
      ["ship", 1, null],
      ["preview", null, "demo"],
      ["demo", 2, null],
      ["restore", null, "demo"],
      ["merge", 3, null],
    ]);
    expect(view.total).toBe(3);
  });

  it("на идущем под-этапе счётчик стоит на номере владельца", () => {
    const view = progressView({ stages: { ship: { startedAt: AT, finishedAt: AT }, preview: { startedAt: AT } }, waiting: [] }, STAGES);
    expect(view.current).toBe("preview");
    expect(view.step).toBe(2);
  });
});
