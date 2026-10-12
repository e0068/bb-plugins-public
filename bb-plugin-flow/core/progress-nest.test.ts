// @vitest-environment node
// Полоса прогона: этапы вложенного flow несут его строку и номер с точкой, следующий за flow этап — номер после него.
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, nestSummary, progressPlaces, progressView } from "./progress";

const BRIEF = [{ id: "nested", name: "Brief" }];
const stage = (id: string, nest?: WorkStage["nest"]): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...(nest === undefined ? {} : { nest }) });
const STAGES = [stage("plugin"), stage("nested.questions", BRIEF), stage("nested.task", BRIEF), stage("spec")];

describe("строки полосы с вложенным flow", () => {
  it("этап вложенного flow несёт строку своего flow", () => {
    expect(progressView(EMPTY_PROGRESS, STAGES).stages.map((s) => s.nest ?? null)).toEqual([null, BRIEF, BRIEF, null]);
  });

  it("номер строки flow — место этапа верхнего уровня, её этапов — с точкой; следующий этап — номер после flow", () => {
    expect(Object.fromEntries(progressPlaces(progressView(EMPTY_PROGRESS, STAGES).stages))).toEqual({ plugin: "1", nested: "2", "nested.questions": "2.1", "nested.task": "2.2", spec: "3" });
  });

  it("вычеркнутый этап номера не получает, соседи по flow сдвигаются", () => {
    const places = progressPlaces(progressView({ stages: { "nested.questions": { skipped: true } }, waiting: [] }, STAGES).stages);
    expect(STAGES.map((s) => places.get(s.id) ?? null)).toEqual(["1", null, "2.1", "3"]);
  });
});

describe("строка вложенного flow в полосе", () => {
  const AT = "2026-10-12T10:00:00.000Z";
  const LATER = "2026-10-12T10:07:00.000Z";
  const flowRow = (progress: Parameters<typeof progressView>[0]) => {
    const rows = progressView(progress, STAGES).stages;
    return nestSummary(BRIEF[0]!, rows.filter((row) => row.nest !== undefined));
  };

  it("несёт id, название и иконку flow, номера у неё нет", () => {
    expect(nestSummary({ id: "nested", name: "Brief", icon: "Album01" }, [])).toMatchObject({ id: "nested", name: "Brief", icon: "Album01", number: null, results: [] });
  });

  it("состояние по этапам: все пройдены — пройдена, один идёт — идёт, все вычеркнуты — вычеркнута, иначе впереди", () => {
    const done = { startedAt: AT, finishedAt: LATER };
    expect(flowRow({ stages: { "nested.questions": done, "nested.task": done }, waiting: [] }).state).toBe("done");
    expect(flowRow({ stages: { "nested.questions": done, "nested.task": { startedAt: AT } }, waiting: [] }).state).toBe("now");
    expect(flowRow({ stages: { "nested.questions": { skipped: true }, "nested.task": { skipped: true } }, waiting: [] }).state).toBe("skip");
    expect(flowRow({ stages: { "nested.questions": done }, waiting: [] }).state).toBe("todo");
  });

  it("минуты и доллары — сумма пройденных этапов", () => {
    const row = flowRow({ stages: { "nested.questions": { startedAt: AT, finishedAt: LATER, cost: 1.5 }, "nested.task": { startedAt: AT, finishedAt: LATER, cost: 2 } }, waiting: [] });
    expect([row.minutes, row.cost]).toEqual([14, 3.5]);
  });
});
