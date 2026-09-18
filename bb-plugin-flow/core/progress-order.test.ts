// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer, onBrief, progressView } from "./progress";
import { report, stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [builtinStage("questions", []), builtinStage("criteria", []), builtinStage("select", []), stage("task")];
const T0 = "2026-09-16T10:00:00.000Z";
const T1 = "2026-09-16T10:05:00.000Z";

const base = { threadId: "thr_1", title: "Бриф", createdAt: T0, kind: "brief" as const, stages: { list: STAGES, minButtonWidth: 170 } };
const a: DecisionBrief = { ...base, id: "dec_a", questions: [], setup: { stages: [report("questions"), report("criteria"), report("select"), report("task", { recommended: true })] } };
const b: DecisionBrief = { ...base, id: "dec_b", questions: [{ id: "q", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }] };

describe("ответ закрывает ожидание только своего брифа", () => {
  it("ответ на уточняющий бриф B после брифа A этапы A не закрывает", () => {
    const progress = onAnswer(onBrief(onBrief(EMPTY_PROGRESS, a, T0), b, T0), b, { briefId: b.id, answers: [] }, T1);
    expect(progressView(progress, STAGES).stages.map((s) => s.state)).toEqual(["now", "now", "now", "todo"]);
  });

  it("ответ на A после B закрывает этапы A", () => {
    const progress = onAnswer(onBrief(onBrief(EMPTY_PROGRESS, a, T0), b, T0), a, { briefId: a.id, answers: [], stages: [{ id: "task", run: true, executor: "self" }] }, T1);
    expect(progressView(progress, STAGES).stages.map((s) => s.state)).toEqual(["done", "done", "done", "todo"]);
  });
});
