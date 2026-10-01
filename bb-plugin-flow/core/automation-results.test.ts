// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { builtinAutomationStage, onRunStart, onStepDone, stepsOf } from "./automation-run";
import { EMPTY_PROGRESS, onMark } from "./progress";
import { stage } from "./stages-fixtures";
import { reportIssues, withStepResults } from "./stages";

const T0 = "2026-10-01T10:00:00.000Z";
const T1 = "2026-10-01T10:01:00.000Z";

const land: WorkStage = { ...builtinAutomationStage([]), id: "land", name: "Land", automation: { source: "flow", steps: ["git.merge", "bb.tasks-done", "bb.archive"] } };
const review = stage("review", { name: "Review" });

const pr = { label: "PR #570", target: "https://github.com/e0068/bb-plugins/pull/570" };
const task = { label: "BBPL-12", target: "docs/tasks/done/flow-ssylki.md" };

const started = onRunStart(EMPTY_PROGRESS, "land", stepsOf(land), T0);
const landed = onStepDone(onStepDone(onStepDone(started, "land", T1, null, [pr]), "land", T1, "BBPL-12", [task]), "land", T1);

describe("итоги автоматизации из ссылок её шагов", () => {
  it("доигранная автоматизация несёт ссылки шагов в их порядке", () => {
    expect(landed.stages.land?.finishedAt).toBe(T1);
    expect(landed.stages.land?.results).toEqual([pr, task]);
  });

  it("шаги без ссылок итогов не дают", () => {
    const quiet = stepsOf(land).reduce((p) => onStepDone(p, "land", T1), started);
    expect(quiet.stages.land?.results).toBeUndefined();
  });

  it("новый прогон этапа начинает итоги заново", () => {
    expect(onRunStart(landed, "land", stepsOf(land), T1).stages.land?.results).toBeUndefined();
  });
});

describe("ссылки сделанной автоматизации в брифе", () => {
  it("проверка отчёта не требует ссылок у сделанной автоматизации", () => {
    expect(reportIssues([review, land], [{ id: "review", state: "done", executor: "self", results: [{ label: "x.md", target: "x.md" }] }, { id: "land", state: "done", executor: "self" }] as never)).toEqual([]);
  });

  it("сделанный этап навыка без ссылок по-прежнему отклоняется", () => {
    expect(reportIssues([review, land], [{ id: "review", state: "done", executor: "self" }, { id: "land", state: "todo", executor: "self" }] as never)).toEqual(["stage review: a done skill stage needs results with links"]);
  });

  it("Flow подставляет сделанной автоматизации итоги её шагов", () => {
    const reports = withStepResults([review, land], [{ id: "review", state: "todo", executor: "self" }, { id: "land", state: "done", executor: "self" }] as never, landed);
    expect(reports?.[1]).toEqual({ id: "land", state: "done", executor: "self", results: [pr, task] });
  });

  it("без итогов шагов у автоматизации остаются ссылки агента, этап навыка не трогается", () => {
    const own = [{ label: "PR #1", target: "https://github.com/o/r/pull/1" }];
    const reports = [{ id: "review", state: "done", executor: "self", results: [{ label: "x.md", target: "x.md" }] }, { id: "land", state: "done", executor: "self", results: own }] as never;
    expect(withStepResults([review, land], reports, onMark(EMPTY_PROGRESS, "review", "done", T1, [{ label: "y.md", target: "y.md" }]))).toEqual(reports);
  });

  it("брифу без этапов подставлять нечего", () => {
    expect(withStepResults([review, land], undefined, landed)).toBeUndefined();
  });
});

describe("одна ссылка от двух шагов", () => {
  it("PR, который открыл и влил один этап, стоит в итогах один раз", () => {
    const ship: WorkStage = { ...builtinAutomationStage([]), id: "ship", name: "Ship", automation: { source: "flow", steps: ["git.create-pr", "git.merge"] } };
    const run = onRunStart(EMPTY_PROGRESS, "ship", stepsOf(ship), T0);
    const shipped = onStepDone(onStepDone(run, "ship", T1, pr.target, [pr]), "ship", T1, null, [pr]);
    expect(shipped.stages.ship?.results).toEqual([pr]);
  });
});
