// Откат автоматизаций при доработке: чьи шаги отката должны пройти, когда агент начинает закрытый этап снова.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { BuiltinAutomation, FlowProgress, WorkStage } from "../shared/contract";
import { removeStep } from "./automation-scripts";
import { undoDue } from "./automation-undo";
import { onRunStart, onStepFailed } from "./automation-run";
import { EMPTY_PROGRESS, onMark, reopen } from "./progress";
import { stage } from "./stages-fixtures";

const AT = "2026-09-30T10:00:00.000Z";

const automation = (id: string, undo?: string[]): WorkStage => ({
  id,
  kind: "skill",
  skill: "",
  name: id,
  executors: [],
  automation: { source: "flow", steps: ["git.commit", "script:preview"], ...(undo === undefined ? {} : { undo: undo as never }), scripts: [{ id: "preview", name: "preview.sh", content: "true" }, { id: "restore", name: "restore.sh", content: "true" }] },
});

const demo: WorkStage = { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] };

const FLOW: WorkStage[] = [stage("implement"), stage("review"), automation("publish", ["script:restore"]), demo, automation("merge", ["script:restore"])];

const done = (progress: FlowProgress, ...ids: string[]): FlowProgress => ids.reduce((p, id) => onMark(onMark(p, id, "started", AT), id, "done", AT), progress);

const ids = (stages: readonly WorkStage[]) => stages.map((s) => s.id);

describe("undoDue", () => {
  it("доработка раннего этапа откатывает закрытую автоматизацию с шагами отката", () => {
    const before = done(EMPTY_PROGRESS, "implement", "review", "publish");
    expect(ids(undoDue(before, FLOW, "implement"))).toEqual(["publish"]);
  });

  it("автоматизация без шагов отката не откатывается", () => {
    const flow = [stage("implement"), automation("publish")];
    expect(undoDue(done(EMPTY_PROGRESS, "implement", "publish"), flow, "implement")).toEqual([]);
  });

  it("незакрытая автоматизация не откатывается: ей нечего отменять", () => {
    expect(undoDue(done(EMPTY_PROGRESS, "implement", "review"), FLOW, "implement")).toEqual([]);
  });

  it("автоматизация раньше начатого заново этапа не откатывается", () => {
    const before = done(EMPTY_PROGRESS, "implement", "review", "publish", "demo");
    expect(undoDue(before, FLOW, "demo")).toEqual([]);
  });

  it("несколько закрытых автоматизаций откатываются в обратном порядке: последняя первой", () => {
    const before = done(EMPTY_PROGRESS, "implement", "review", "publish", "demo", "merge");
    expect(ids(undoDue(before, FLOW, "implement"))).toEqual(["merge", "publish"]);
  });

  it("старт незакрытого этапа — обычный прогон, а не доработка: откатов нет", () => {
    const before = done(EMPTY_PROGRESS, "review", "publish");
    expect(undoDue(before, FLOW, "implement")).toEqual([]);
  });

  it("этап вне flow откатов не даёт", () => {
    expect(undoDue(done(EMPTY_PROGRESS, "implement", "publish"), FLOW, "ghost")).toEqual([]);
  });
});

describe("removeStep и откат", () => {
  it("убранный шаг-скрипт уходит и из шагов отката, чтобы откат не ссылался на скрипт, которого нет", () => {
    const withBoth: BuiltinAutomation = { source: "flow", steps: ["script:restore"], undo: ["script:restore"], scripts: [{ id: "restore", name: "restore.sh", content: "true" }] };
    expect(removeStep(withBoth, "script:restore")).toEqual({ source: "flow", steps: [], undo: [], scripts: [] });
  });

  it("автоматизация без отката остаётся без поля undo", () => {
    const plain: BuiltinAutomation = { source: "flow", steps: ["git.commit", "git.merge"] };
    expect(removeStep(plain, "git.merge")).toEqual({ source: "flow", steps: ["git.commit"] });
  });
});

describe("undoDue и сброшенные доработкой автоматизации", () => {
  const failed = (progress: FlowProgress, id: string): FlowProgress => onStepFailed(onRunStart(progress, id, [{ id: "script:preview", label: "preview.sh" }], AT), id, "mail keeps secrets", AT);

  it("упавшая на середине автоматизация тоже откатывается: часть её шагов уже сделана", () => {
    const before = failed(done(EMPTY_PROGRESS, "implement", "review"), "publish");
    expect(ids(undoDue(before, FLOW, "implement"))).toEqual(["publish"]);
  });

  it("откатывается ровно то, что доработка сбрасывает, — закрытое или начатое, с шагами отката", () => {
    const flowIds = ids(FLOW);
    fc.assert(
      fc.property(fc.subarray(flowIds), fc.subarray(["publish", "merge"]), fc.constantFrom(...flowIds), (closed, broken, id) => {
        const before = broken.filter((b) => !closed.includes(b)).reduce(failed, done(EMPTY_PROGRESS, ...closed));
        const after = reopen(before, FLOW, id);
        const reset = FLOW.filter((s) => s.id !== id && JSON.stringify(before.stages[s.id]) !== JSON.stringify(after.stages[s.id]));
        const expected = reset.filter((s) => s.automation !== undefined && "source" in s.automation && (s.automation.undo?.length ?? 0) > 0);
        expect(ids(undoDue(before, FLOW, id))).toEqual(ids(expected).reverse());
      }),
    );
  });
});
