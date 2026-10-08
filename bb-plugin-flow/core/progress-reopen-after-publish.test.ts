// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, pendingAutomation, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark, progressView, reopen } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-10-05T09:00:00.000Z";
const T1 = "2026-10-05T09:08:00.000Z";
const T2 = "2026-10-05T11:03:05.000Z";
const T3 = "2026-10-05T11:10:32.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Commit, FF to Main, PR", automation: { source: "flow", steps: ["git.create-pr"] } };
const preview: WorkStage = { ...builtinAutomationStage([]), id: "preview", name: "Plugin Preview", automation: { source: "flow", steps: ["git.create-pr"] } };
const STAGES: WorkStage[] = [stage("practice"), stage("review"), publish, preview, builtinStage("demo", []), stage("docs")];

/** Отметки так, как их пишет flow_stage: «started» сперва сбрасывает этапы за доработкой. */
const start = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(reopen(progress, STAGES, id, at), id, "started", at);
const done = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(progress, id, "done", at);
const runThrough = (progress: FlowProgress, automation: WorkStage): FlowProgress =>
  stepsOf(automation).reduce((p) => onStepDone(p, automation.id, T1), onRunStart(progress, automation.id, stepsOf(automation), T0));
const forNextPass = (progress: FlowProgress, ids: readonly string[]): FlowProgress => ({
  ...progress,
  stages: Object.fromEntries(Object.entries(progress.stages).map(([id, track]) => [id, ids.includes(id) ? { ...track, nextPass: { skipped: true } } : track])),
});

/**
 * Тред «Боковое меню — Empty State колокольчика»: Execution, ревью и коммит с PR прошли, затем владелец ответил брифом
 * с прогоном «Plugin Preview → Демонстрация» — пройденные этапы в него не вошли, ответ записал им «вне прогона» на следующий проход.
 * Демонстрация ждёт, нетронутый этап docs вычеркнут.
 */
const published = (): FlowProgress => {
  const worked = runThrough(done(start(done(start({ ...EMPTY_PROGRESS, stages: { docs: { skipped: true } } }, "practice", T0), "practice", T1), "review", T1), "review", T1), publish);
  const answered = forNextPass(worked, ["practice", "review", "publish"]);
  return { ...answered, stages: { ...answered.stages, demo: { startedAt: T1 } }, waiting: ["demo"] };
};

describe("доработка после коммита и PR, которых нет в прогоне ответа", () => {
  it("снова начатый Execution возвращает в прогон коммит с PR, а снятое ответом ревью остаётся снятым", () => {
    const view = Object.fromEntries(progressView(start(published(), "practice", T2), STAGES).stages.map((s) => [s.id, s.state]));
    expect(view).toEqual({ practice: "now", review: "skip", publish: "todo", preview: "todo", demo: "todo", docs: "skip" });
  });

  it("коммит с PR наступает на «done» Execution, раньше превью: правки доработки дойдут до PR", () => {
    const reworked = done(start(published(), "practice", T2), "practice", T3);
    expect(pendingAutomation(STAGES, reworked)).toEqual({ stage: publish, from: null });
  });
});
