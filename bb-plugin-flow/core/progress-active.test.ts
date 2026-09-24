// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onMark, pendingActive, progressView, withActive } from "./progress";
import { stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [builtinStage("questions", []), stage("task", { name: "Задача" }), stage("code", { name: "Реализация" }), builtinStage("demo", [])];

const T0 = "2026-09-16T10:00:00.000Z";
const T1 = "2026-09-16T10:12:00.000Z";
const LINK = { label: "task.md", target: "docs/tasks/task.md" };

const closed = (minutes?: number): FlowProgress => onMark(onMark(EMPTY_PROGRESS, "task", "started", T0), "task", "done", T1, [LINK], 1.8, minutes);

const row = (progress: FlowProgress, id: string) => progressView(progress, STAGES).stages.find((s) => s.id === id)!;

describe("активные минуты этапа", () => {
  it("конец этапа с активными минутами: они в минутах строки, стенные часы отдельно", () => {
    expect(row(closed(4), "task")).toMatchObject({ minutes: 4, wallMinutes: 12, cost: 1.8 });
  });

  it("этап без активных минут показывает стенные часы", () => {
    expect(row(closed(), "task")).toMatchObject({ minutes: 12, wallMinutes: 12 });
  });

  it("ноль активных минут показывается нулём, а не длительностью ожидания", () => {
    expect(row(closed(0), "task")).toMatchObject({ minutes: 0, wallMinutes: 12 });
  });

  it("добора ждут только закрытые этапы прогона без активных минут", () => {
    const started = onMark(closed(), "code", "started", T1);
    expect(pendingActive(started)).toEqual([{ id: "task", from: Date.parse(T0), to: Date.parse(T1) }]);
    expect(pendingActive(closed(4))).toEqual([]);
    expect(pendingActive({ ...closed(), stages: { ...closed().stages, task: { ...closed().stages.task, skipped: true } } })).toEqual([]);
  });

  it("добор пишет минуты и не трогает остальное в этапе", () => {
    const filled = withActive(closed(), [{ id: "task", minutes: 4 }]);
    expect(filled.stages.task).toMatchObject({ activeMinutes: 4, cost: 1.8, results: [LINK], startedAt: T0, finishedAt: T1 });
    expect(pendingActive(filled)).toEqual([]);
  });
});

describe("номера этапов", () => {
  const progress: FlowProgress = { stages: { questions: { startedAt: T0, finishedAt: T0 }, task: { startedAt: T0, finishedAt: T1 }, code: { skipped: true } }, waiting: [] };

  it("нумеруются только этапы прогона, вычеркнутый номера не получает", () => {
    const view = progressView(progress, STAGES);
    expect(view.stages.map((s) => s.number)).toEqual([1, 2, null, 3]);
  });

  it("номер идущего этапа равен числителю счётчика, номер последнего — знаменателю", () => {
    const view = progressView(progress, STAGES);
    expect(view.stages.find((s) => s.id === view.current)?.number).toBe(view.step);
    expect(view.stages.filter((s) => s.number !== null).at(-1)?.number).toBe(view.total);
  });
});
