import { describe, expect, it } from "vitest";

import { flowStepOrderProblem, opensPrBefore, stepOrderProblem } from "./automation-order";
import { stage } from "./stages-fixtures";
import type { Flow, WorkStage } from "../shared/contract";

const chain = (id: string, steps: string[]): WorkStage =>
  stage(id, { name: id, skill: "", automation: { source: "flow", steps: steps as never } });

const external = (id: string): WorkStage => stage(id, { name: id, skill: "", automation: { id: "auto-1", name: "Pull Request" } });

const flow = (stages: WorkStage[]): Flow => ({ id: "default", name: "Default", stages });

const WORKING = [
  stage("implement"),
  chain("flow-automation", ["git.commit", "git.fast-forward", "git.create-pr"]),
  stage("demo"),
  chain("flow-automation-2", ["files.bump-patch", "git.merge", "git.pull-main", "bb.tasks-done", "bb.archive"]),
];

describe("stepOrderProblem", () => {
  it("рабочий flow: PR открывает первая цепочка, мёрджит вторая", () => {
    expect(stepOrderProblem([flow(WORKING)])).toBeNull();
  });

  it("бамп раньше открытия PR в той же цепочке — названы flow, этап и шаг", () => {
    const broken = flow([chain("flow-automation", ["git.commit", "files.bump-patch", "git.fast-forward", "git.create-pr"])]);
    expect(flowStepOrderProblem(broken)).toEqual({ flowId: "default", flowName: "Default", stageId: "flow-automation", stageName: "flow-automation", step: "files.bump-patch" });
  });

  it("мёрдж без открытия PR вовсе — тоже отказ", () => {
    expect(flowStepOrderProblem(flow([chain("a", ["git.merge"])]))?.step).toBe("git.merge");
  });

  it("сломан второй flow коллекции — находится и он", () => {
    const problem = stepOrderProblem([flow(WORKING), { id: "f2", name: "Второй", stages: [chain("a", ["files.bump-minor"])] }]);
    expect(problem).toMatchObject({ flowId: "f2", step: "files.bump-minor" });
  });

  it("автоматизация Automations — чёрный ящик: запрета после неё нет", () => {
    expect(flowStepOrderProblem(flow([external("ext"), chain("a", ["git.merge"])]))).toBeNull();
  });

  it("скрипт шагом не мешает: он не открывает PR, но и не запрещает", () => {
    expect(flowStepOrderProblem(flow([chain("a", ["script:s1", "git.create-pr", "files.bump-patch"])]))).toBeNull();
  });
});

describe("opensPrBefore", () => {
  it("вторая цепочка знает, что PR уже открыт первой", () => {
    expect(opensPrBefore(WORKING, "flow-automation-2")).toBe(true);
  });

  it("первая цепочка сама PR ещё не открыла — до её шагов его нет", () => {
    expect(opensPrBefore([chain("a", ["git.commit"]), chain("b", [])], "a")).toBe(false);
  });

  it("цепочка, в которой уже стоит открытие PR, считает его своим", () => {
    expect(opensPrBefore([chain("a", ["git.commit", "git.create-pr"])], "a")).toBe(true);
  });
});
