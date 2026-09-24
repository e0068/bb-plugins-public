// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { recounted, recountWindows } from "./progress";

const RUN: FlowProgress = {
  stages: {
    implement: { startedAt: "2026-09-24T00:00:00.000Z", finishedAt: "2026-09-24T10:00:00.000Z", cost: 6.41, activeMinutes: 14 },
    questions: { startedAt: "2026-09-23T23:00:00.000Z", finishedAt: "2026-09-23T23:10:00.000Z" },
    task: { startedAt: "2026-09-23T23:10:00.000Z" },
  },
  waiting: [],
};

describe("пересчёт этапов по всем тредам прогона", () => {
  it("пересчитываются закрытые этапы, доллары — только у этапов, у которых они были", () => {
    expect(recountWindows(RUN)).toEqual([
      { id: "implement", from: Date.parse("2026-09-24T00:00:00.000Z"), to: Date.parse("2026-09-24T10:00:00.000Z"), priced: true },
      { id: "questions", from: Date.parse("2026-09-23T23:00:00.000Z"), to: Date.parse("2026-09-23T23:10:00.000Z"), priced: false },
    ]);
  });

  it("пересчёт помечает запись и кладёт новые числа", () => {
    const after = recounted(RUN, [{ id: "implement", minutes: 433, cost: 263.2 }, { id: "questions", minutes: 3 }]);
    expect(after.countedAcrossRun).toBe(true);
    expect(after.stages.implement).toMatchObject({ activeMinutes: 433, cost: 263.2 });
    expect(after.stages.questions).toMatchObject({ activeMinutes: 3 });
  });

  it("лог, которого уже нет, не делает этап меньше: минуты и доллары ниже прежних не опускаются", () => {
    const after = recounted(RUN, [{ id: "implement", minutes: 0, cost: 1 }]);
    expect(after.stages.implement).toMatchObject({ activeMinutes: 14, cost: 6.41 });
  });
});
