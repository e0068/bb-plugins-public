// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer, onBrief, onMark, progressView } from "./progress";
import { add, report, stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [stage("task", { name: "Задача" }), stage("spec", { name: "Спецификация" })];
const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:05:00.000Z";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: T0,
  kind: "brief",
  questions: [],
  stages: { list: STAGES, minButtonWidth: 170 },
  setup: { stages: [report("task", { recommended: true, add: add(1, 2, 0, 3) }), report("spec", { recommended: true, add: add(2, 4, 0, 9) })] },
};

const answered = () => onAnswer(onBrief(EMPTY_PROGRESS, brief, T0), brief, { briefId: brief.id, answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "spec", run: true, executor: "self" }] }, T1);

describe("план этапа в контейнере состояния Flow", () => {
  it("этапы впереди несут план из ответа на бриф", () => {
    const view = progressView(answered(), STAGES);
    expect(view.stages.map((s) => s.plan)).toEqual([{ minutes: 3, target: 1 }, { minutes: 9, target: 2 }]);
  });

  it("пройденный этап плана больше не показывает — у него есть факт", () => {
    const view = progressView(onMark(onMark(answered(), "task", "started", T1), "task", "done", T1), STAGES);
    expect(view.stages[0]!.plan).toBeUndefined();
    expect(view.stages[1]!.plan).toEqual({ minutes: 9, target: 2 });
  });
});
