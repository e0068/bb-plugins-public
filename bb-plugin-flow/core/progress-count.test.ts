// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer, onBrief, onMark, progressView } from "./progress";
import { report, stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [builtinStage("questions", []), builtinStage("select", []), stage("task"), stage("plan"), stage("code"), builtinStage("demo", [])];

const T0 = "2026-09-17T10:00:00.000Z";
const T1 = "2026-09-17T10:05:00.000Z";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: T0,
  kind: "brief",
  questions: [],
  stages: { list: STAGES, minButtonWidth: 170 },
  setup: { stages: [report("questions"), report("select"), report("task", { recommended: true }), report("plan"), report("code", { recommended: true }), report("demo")] },
};

const run = (answered: Array<[string, boolean]>) =>
  onAnswer(onBrief(EMPTY_PROGRESS, brief, T0), brief, { briefId: brief.id, answers: [], stages: answered.map(([id, inRun]) => ({ id, run: inRun, executor: "self" })) }, T1);

describe("счёт прогресса — по этапам прогона", () => {
  it("вычеркнутые этапы не нумеруются: номер текущего этапа среди этапов прогона из их числа", () => {
    const progress = onMark(onMark(run([["task", true], ["plan", false], ["code", true], ["demo", false]]), "task", "done", T1), "code", "started", T1);
    expect(progressView(progress, STAGES)).toMatchObject({ current: "code", step: 4, total: 4 });
  });

  it("следующий, ещё не начатый этап прогона тоже считается текущим номером", () => {
    const progress = onMark(run([["task", true], ["plan", false], ["code", true], ["demo", false]]), "task", "done", T1);
    expect(progressView(progress, STAGES)).toMatchObject({ current: "code", step: 4, total: 4 });
  });

  it("когда все этапы прогона сделаны, номер равен их числу", () => {
    const progress = onMark(onMark(run([["task", true], ["plan", false], ["code", true], ["demo", false]]), "task", "done", T1), "code", "done", T1);
    expect(progressView(progress, STAGES)).toMatchObject({ current: null, step: 4, total: 4 });
  });

  it("до ответа ни один этап не вычеркнут: считаются все этапы flow", () => {
    expect(progressView(onBrief(EMPTY_PROGRESS, brief, T0), STAGES)).toMatchObject({ current: "questions", step: 1, total: 6 });
  });
});
