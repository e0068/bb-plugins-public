// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, pendingAutomation, stepsOf } from "./automation-run";
import { afterMark } from "./mark-report";
import { EMPTY_PROGRESS, onMark, progressView, reopen } from "./progress";
import { stage } from "./stages-fixtures";

const T0 = "2026-10-05T11:00:00.000Z";
const T1 = "2026-10-05T11:10:00.000Z";
const T2 = "2026-10-05T11:14:51.000Z";
const T3 = "2026-10-05T11:14:56.000Z";

const preview: WorkStage = { ...builtinAutomationStage([]), id: "preview", name: "Plugin Preview", automation: { source: "flow", steps: ["git.create-pr"] } };
const STAGES: WorkStage[] = [stage("brief"), stage("practice"), stage("review"), preview, builtinStage("demo", [])];

/** Отметки так, как их пишет flow_stage: «started» сперва сбрасывает этапы за доработкой. */
const start = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(reopen(progress, STAGES, id, at), id, "started", at);
const done = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(progress, id, "done", at);
const runThrough = (progress: FlowProgress): FlowProgress => stepsOf(preview).reduce((p) => onStepDone(p, preview.id, T1), onRunStart(progress, preview.id, stepsOf(preview), T0));

/**
 * Тред «Боковое меню — Empty State колокольчика»: владелец не взял Execution и ревью в прогон, агент всё равно сделал Execution,
 * Plugin Preview за ним прошёл, Демонстрация ждёт. Комментарий владельца — доработка: агент снова начинает Execution.
 */
const demoAfterUnplannedWork = (): FlowProgress => {
  const base: FlowProgress = { ...EMPTY_PROGRESS, stages: { brief: { startedAt: T0, finishedAt: T0 }, practice: { skipped: true }, review: { skipped: true } } };
  const ran = runThrough(done(base, "practice", T1));
  return { ...ran, stages: { ...ran.stages, demo: { startedAt: T1 } }, waiting: ["demo"] };
};

describe("доработка этапа, который владелец не брал в прогон", () => {
  it("снова начатый этап возвращается в прогон: автоматизация за ним не наступает, пока он идёт", () => {
    const reworking = start(demoAfterUnplannedWork(), "practice", T2);
    expect(progressView(reworking, STAGES).stages.find((s) => s.id === "practice")?.state).toBe("now");
    expect(pendingAutomation(STAGES, reworking)).toBeNull();
  });

  it("автоматизация за ним наступает на его «done», и отметка ждёт её, а не отвечает «уже прошла»", () => {
    const reworked = done(start(demoAfterUnplannedWork(), "practice", T2), "practice", T3);
    expect(pendingAutomation(STAGES, reworked)).toEqual({ stage: preview, from: null });
    expect(afterMark(STAGES, reworked, "practice")).toEqual({ kind: "due", stage: preview });
  });

  it("вычеркнутый этап, который агент не трогал, остаётся вычеркнутым", () => {
    const reworking = start(demoAfterUnplannedWork(), "practice", T2);
    expect(reworking.stages.review?.skipped).toBe(true);
  });
});
