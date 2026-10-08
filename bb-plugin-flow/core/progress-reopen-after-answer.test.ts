// @vitest-environment node
// Доработка после ответа владельца, который не взял пройденные этапы в новый проход: выбор записывает настоящий onAnswer.
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, pendingAutomation, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onAnswer, onMark, progressView, reopen } from "./progress";
import { report, stage } from "./stages-fixtures";

const T0 = "2026-10-05T09:00:00.000Z";
const T1 = "2026-10-05T09:08:00.000Z";
const T2 = "2026-10-05T09:13:37.000Z";
const T3 = "2026-10-05T11:03:05.000Z";
const T4 = "2026-10-05T11:10:32.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Commit, FF to Main, PR", automation: { source: "flow", steps: ["git.create-pr"] } };
const preview: WorkStage = { ...builtinAutomationStage([]), id: "preview", name: "Plugin Preview", automation: { source: "flow", steps: ["bb.reinstall"] } };
const STAGES: WorkStage[] = [stage("practice"), stage("review"), publish, preview, builtinStage("demo", [])];

const start = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(reopen(progress, STAGES, id, at), id, "started", at);
const done = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(progress, id, "done", at);

const brief: DecisionBrief = {
  id: "dec_after_publish",
  threadId: "thr_1",
  title: "Футер — шапки, пустое состояние",
  createdAt: T2,
  kind: "brief",
  questions: [],
  stages: { list: STAGES, minButtonWidth: 170 },
  setup: { stages: STAGES.map(({ id }) => report(id)) },
};

/** Execution, ревью и коммит с PR прошли; ответ владельца взял в прогон только превью и Демонстрацию. */
const answered = (): FlowProgress => {
  const worked = done(start(done(start(EMPTY_PROGRESS, "practice", T0), "practice", T1), "review", T1), "review", T1);
  const published = stepsOf(publish).reduce((p) => onStepDone(p, publish.id, T1), onRunStart(worked, publish.id, stepsOf(publish), T1));
  return onAnswer(published, brief, {
    briefId: brief.id,
    answers: [],
    stages: [
      { id: "practice", run: false, executor: "self" },
      { id: "review", run: false, executor: "self" },
      { id: "publish", run: false, executor: "self" },
      { id: "preview", run: true, executor: "self" },
      { id: "demo", run: true, executor: "self" },
    ],
  }, T2);
};

describe("доработка после ответа, не взявшего коммит с PR в новый проход", () => {
  it("снова начатый Execution возвращает коммит с PR в прогон, снятое ответом ревью остаётся снятым", () => {
    const view = Object.fromEntries(progressView(start(answered(), "practice", T3), STAGES).stages.map((s) => [s.id, s.state]));
    expect(view).toMatchObject({ practice: "now", review: "skip", publish: "todo" });
  });

  it("на «done» Execution наступает коммит с PR, а не превью", () => {
    expect(pendingAutomation(STAGES, done(start(answered(), "practice", T3), "practice", T4))).toEqual({ stage: publish, from: null });
  });
});
