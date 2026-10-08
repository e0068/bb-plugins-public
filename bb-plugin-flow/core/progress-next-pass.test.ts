// @vitest-environment node
// Новая работа в треде с пройденным прогоном: выбор этапов в ответе касается и этапов, пройденных прошлым проходом.
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer, onMark, progressView, reopen } from "./progress";
import { runSummary } from "./run-summary";
import { report, stage } from "./stages-fixtures";

const STAGES: WorkStage[] = [stage("task"), stage("prototype"), builtinStage("demo", []), stage("spec"), stage("review")];

const T0 = "2026-10-01T08:00:00.000Z";
const T1 = "2026-10-01T09:00:00.000Z";
const T2 = "2026-10-01T10:00:00.000Z";
const T3 = "2026-10-01T10:05:00.000Z";

const passed = (): FlowProgress =>
  STAGES.reduce((p, { id }) => onMark(onMark(p, id, "started", T0), id, "done", T1, [{ label: `${id}.md`, target: `docs/${id}.md` }], 1, 10), EMPTY_PROGRESS);

const brief: DecisionBrief = {
  id: "dec_2",
  threadId: "thr_1",
  title: "Новая работа",
  createdAt: T2,
  kind: "brief",
  questions: [],
  stages: { list: STAGES, minButtonWidth: 170 },
  setup: { stages: STAGES.map(({ id }) => report(id)) },
};

const answered = (): FlowProgress =>
  onAnswer(passed(), brief, {
    briefId: brief.id,
    answers: [],
    stages: [
      { id: "task", run: true, executor: "self" },
      { id: "prototype", run: false, executor: "self" },
      { id: "demo", run: false, executor: "self" },
      { id: "spec", run: true, executor: "self" },
      { id: "review", run: true, executor: "agent:code-reviewer" },
    ],
  }, T2);

const states = (progress: FlowProgress) => Object.fromEntries(progressView(progress, STAGES).stages.map((s) => [s.id, s.state]));

describe("выбор этапов на пройденном прогоне", () => {
  it("до нового прохода пройденные этапы остаются пройденными, итог прошлого прохода не меняется", () => {
    const progress = answered();
    expect(states(progress)).toEqual({ task: "done", prototype: "done", demo: "done", spec: "done", review: "done" });
    expect(runSummary(progress, STAGES)).toEqual(runSummary(passed(), STAGES));
  });

  it("новый проход: этапы, снятые ответом, — вне прогона, взятые — впереди с выбранным исполнителем", () => {
    const progress = onMark(reopen(answered(), STAGES, "task", T3), "task", "started", T3);
    expect(states(progress)).toEqual({ task: "now", prototype: "skip", demo: "skip", spec: "todo", review: "todo" });
    expect(progress.stages.review?.executor).toBe("agent:code-reviewer");
  });
});
