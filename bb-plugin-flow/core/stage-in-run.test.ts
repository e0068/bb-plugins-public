import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { EMPTY_PROGRESS, setStageInRun } from "./progress";

const AT = "2026-10-01T10:00:00.000Z";

const ahead: FlowProgress = { stages: { code: {}, review: { skipped: true } }, waiting: [] };

describe("владелец убирает и возвращает этап, до которого прогон ещё не дошёл", () => {
  it("этап без записи убирается из прогона", () => {
    expect(setStageInRun(EMPTY_PROGRESS, "code", false).stages.code).toEqual({ skipped: true });
  });

  it("убранный этап возвращается в прогон", () => {
    expect(setStageInRun(ahead, "review", true).stages.review).toEqual({ skipped: false });
  });

  it("начатый, закрытый, ждущий владельца и этап со шагами не меняются", () => {
    const touched: FlowProgress = {
      stages: { started: { startedAt: AT }, closed: { startedAt: AT, finishedAt: AT }, asked: {}, stepped: { run: { steps: [], at: 0, error: null } } as never },
      waiting: ["asked"],
    };
    for (const id of ["started", "closed", "asked", "stepped"]) {
      expect(setStageInRun(touched, id, false)).toBe(touched);
      expect(setStageInRun(touched, id, true)).toBe(touched);
    }
  });

  it("свойство: два переключения подряд возвращают этап к исходному составу прогона", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (initial, run) => {
        const before: FlowProgress = { stages: { s: { skipped: initial } }, waiting: [] };
        const twice = setStageInRun(setStageInRun(before, "s", run), "s", !initial);
        expect(twice.stages.s?.skipped).toBe(initial);
      }),
    );
  });

  it("свойство: другие этапы записи не меняются", () => {
    fc.assert(
      fc.property(fc.boolean(), (run) => {
        expect(setStageInRun(ahead, "code", run).stages.review).toBe(ahead.stages.review);
      }),
    );
  });
});
