// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, pendingAutomation, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark, progressView, reopen } from "./progress";
import { runSummary } from "./run-summary";
import { stage } from "./stages-fixtures";

const T0 = "2026-09-30T10:00:00.000Z";
const T1 = "2026-09-30T10:10:00.000Z";
const T2 = "2026-09-30T11:00:00.000Z";
const T3 = "2026-09-30T11:20:00.000Z";

const publish: WorkStage = { ...builtinAutomationStage([]), id: "publish", name: "Commit, FF, PR", automation: { source: "flow", steps: ["git.create-pr"] } };
const STAGES: WorkStage[] = [stage("task"), stage("spec"), stage("implement"), stage("review"), publish, builtinStage("demo", []), stage("docs")];

/** Отметка начала так, как её пишет flow_stage: сперва сброс следующих, потом старт. */
const start = (progress: FlowProgress, id: string, at: string): FlowProgress => onMark(reopen(progress, STAGES, id), id, "started", at);
const pass = (progress: FlowProgress, id: string, from: string, to: string, cost?: number, minutes?: number): FlowProgress =>
  onMark(start(progress, id, from), id, "done", to, [{ label: `${id}.md`, target: `docs/${id}.md` }], cost, minutes);
const runThrough = (progress: FlowProgress): FlowProgress => stepsOf(publish).reduce((p) => onStepDone(p, publish.id, T1), onRunStart(progress, publish.id, stepsOf(publish), T0));
const skip = (progress: FlowProgress, id: string): FlowProgress => ({ ...progress, stages: { ...progress.stages, [id]: { skipped: true, executor: "self" } } });

/** Работа дошла до Демонстрации: задача, реализация и ревью закрыты, коммит прошёл, спека и docs вычеркнуты, Демонстрация ждёт. */
const committed = (): FlowProgress => {
  const worked = ["task", "implement", "review"].reduce((p, id) => pass(p, id, T0, T1, 2, 10), skip(skip(EMPTY_PROGRESS, "spec"), "docs"));
  const demo = runThrough(worked);
  return { ...demo, stages: { ...demo.stages, demo: { startedAt: T1 } }, waiting: ["demo"] };
};

const states = (progress: FlowProgress) => Object.fromEntries(progressView(progress, STAGES).stages.map((s) => [s.id, s.state]));

describe("доработка: снова начатый этап снимает готовность со всех этапов прогона после него", () => {
  it("возврат на реализацию после коммита: ревью, коммит и Демонстрация снова впереди, вычеркнутые остаются вычеркнутыми", () => {
    expect(states(start(committed(), "implement", T2))).toEqual({ task: "done", spec: "skip", implement: "now", review: "todo", publish: "todo", demo: "todo", docs: "skip" });
  });

  it("сброшенный этап перестаёт ждать владельца, помнит исполнителя, выбранного ответом, и траты первого прохода", () => {
    const withExecutor = committed();
    const progress = start({ ...withExecutor, stages: { ...withExecutor.stages, review: { ...withExecutor.stages.review, executor: "agent:code-reviewer" } } }, "implement", T2);
    expect(progress.waiting).toEqual([]);
    expect(progress.stages.review).toEqual({ executor: "agent:code-reviewer", earlier: { cost: 2, minutes: 10, wall: 10, from: T0 } });
  });

  it("автоматизация коммита наступает снова, когда этапы перед ней закрыты повторно", () => {
    const reworking = start(committed(), "implement", T2);
    expect(pendingAutomation(STAGES, reworking)).toBeNull();
    const reworked = pass(onMark(reworking, "implement", "done", T3), "review", T3, T3);
    expect(pendingAutomation(STAGES, reworked)).toEqual({ stage: publish, from: null });
  });

  it("деньги и минуты первого прохода складываются с повторным в итоге прогона и в строке этапа", () => {
    const redone = ["implement", "review"].reduce((p, id) => pass(p, id, T2, T3, 3, 15), start(committed(), "implement", T2));
    const summary = runSummary(runThrough(redone), STAGES.filter((s) => s.id !== "demo"));
    // Коммит без цены, по десять минут на каждый прогон шагов.
    expect(summary).toMatchObject({ cost: 2 + 2 * (2 + 3), minutes: 10 + 2 * (10 + 15) + 2 * 10 });
    expect(progressView(redone, STAGES).stages.find((s) => s.id === "implement")).toMatchObject({ cost: 5, minutes: 25 });
  });

  it("стенные минуты строки этапа и окно итога прогона помнят первый проход", () => {
    const redone = ["task", "implement"].reduce((p, id) => pass(p, id, T2, T3), start(committed(), "task", T2));
    expect(progressView(redone, STAGES).stages.find((s) => s.id === "task")).toMatchObject({ minutes: 10 + 20, wallMinutes: 10 + 20 });
    expect(runSummary(redone, STAGES)).toMatchObject({ startedAt: T0, finishedAt: T3 });
  });

  it("первый старт этапа при нетронутых следующих ничего за ним не меняет", () => {
    fc.assert(
      fc.property(fc.constantFrom(...STAGES.map((s) => s.id)), (id) => {
        const before = skip(EMPTY_PROGRESS, "docs");
        expect(reopen(before, STAGES, id)).toEqual(before);
      }),
    );
  });

  it("старт этапа, который ещё не закрывался, не трогает закрытые этапы после него", () => {
    const later = pass(skip(EMPTY_PROGRESS, "docs"), "review", T0, T1);
    expect(reopen(later, STAGES, "implement")).toEqual(later);
  });

  it("повторная отметка начала у идущего этапа ничего не сбрасывает", () => {
    const going = start(committed(), "implement", T2);
    expect(start(going, "implement", T3)).toEqual(going);
  });

  it("этап вне flow ничего не сбрасывает", () => {
    const progress = committed();
    expect(reopen(progress, STAGES, "ghost")).toEqual(progress);
  });
});
