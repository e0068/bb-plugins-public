import { describe, expect, it } from "vitest";

import { doneBeforeMergeSteps } from "./automation-order";
import { stage } from "./stages-fixtures";
import type { WorkStage } from "../shared/contract";

const chain = (id: string, steps: string[]): WorkStage =>
  stage(id, { name: id, skill: "", automation: { source: "flow", steps: steps as never } });

const external = (id: string): WorkStage => stage(id, { name: id, skill: "", automation: { id: "auto-1", name: "Pull Request" } });

describe("doneBeforeMergeSteps", () => {
  it("«Задача → done» левее «Смёрджить PR» в том же этапе помечен: кода треда ещё нет в main", () => {
    const stages = [chain("finalize", ["bb.tasks-done", "files.bump-patch", "git.merge", "git.pull-main"])];
    expect(doneBeforeMergeSteps(stages, "finalize")).toEqual(["bb.tasks-done"]);
  });

  it("«Задача → done» правее «Смёрджить PR» — помечать нечего", () => {
    const stages = [chain("finalize", ["files.bump-patch", "git.merge", "git.pull-main", "bb.tasks-done", "bb.archive"])];
    expect(doneBeforeMergeSteps(stages, "finalize")).toEqual([]);
  });

  it("в этапе нет «Смёрджить PR» — правило молчит: мёрдж мог сделать другой этап или владелец", () => {
    expect(doneBeforeMergeSteps([chain("a", ["git.commit", "bb.tasks-done"])], "a")).toEqual([]);
    expect(doneBeforeMergeSteps([chain("a", ["bb.tasks-done"]), chain("b", ["git.merge"])], "a")).toEqual([]);
  });

  it("«Факт → задача» левее мёрджа не помечен: ему код в main не нужен", () => {
    expect(doneBeforeMergeSteps([chain("a", ["bb.tasks-fact", "git.merge"])], "a")).toEqual([]);
  });

  it("автоматизация Automations, неизвестный этап и этап без автоматизации — пусто", () => {
    expect(doneBeforeMergeSteps([external("ext")], "ext")).toEqual([]);
    expect(doneBeforeMergeSteps([chain("a", ["bb.tasks-done", "git.merge"])], "missing")).toEqual([]);
    expect(doneBeforeMergeSteps([stage("implement")], "implement")).toEqual([]);
  });
});
