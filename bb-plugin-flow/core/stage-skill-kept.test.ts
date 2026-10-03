// @vitest-environment node
// Навык — поле любого этапа: смена исполнения его не стирает, а встроенный этап можно оставить без навыка.
import { describe, expect, it } from "vitest";

import { actionStage, builtinStage, NO_SKILL, stageSkillOf } from "../lib/stage-constants";
import type { StageExecutor, WorkStage } from "../shared/contract";
import { builtinAutomationStage } from "./automation-run";
import { withExecutor, withoutWidget, withRun, withSteps } from "./stage-execution";
import { stageInstructions } from "./stages";

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer" };
const addCommit = withSteps((automation) => ({ ...automation, steps: [...automation.steps, "git.commit"] }));
const script: WorkStage = { ...builtinAutomationStage([]), id: "ship", name: "Ship", skill: "git-hygiene", automation: { source: "flow", steps: ["git.commit"] } };
const cleared: WorkStage = { ...builtinStage("demo", []), skill: NO_SKILL };

describe("навык при смене исполнения", () => {
  it("шаги на этапе навыка снимают исполнителей, навык остаётся", () => {
    expect(addCommit({ id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [reviewer] })).toMatchObject({ skill: "spec", executors: [] });
  });

  it("шаги на виджете берут навык, что был виден в поле", () => {
    expect(addCommit(builtinStage("questions", [])).skill).toBe("flow-questions");
  });

  it("шаги и запуск кнопкой у этапа со скриптом навык не трогают", () => {
    expect(addCommit(script).skill).toBe("git-hygiene");
    expect(withRun(script, true).skill).toBe("git-hygiene");
    expect(withRun({ ...actionStage([]), skill: "git-hygiene" }, false).skill).toBe("git-hygiene");
  });

  it("исполнитель на этапе со скриптом оставляет его навык", () => {
    expect(withExecutor(script, reviewer, "Ship")).toMatchObject({ kind: "skill", skill: "git-hygiene", executors: [reviewer] });
  });
});

describe("встроенный этап без навыка", () => {
  it("поле пустое, а не навык вида по умолчанию", () => {
    expect(stageSkillOf(cleared)).toBe("");
    expect(stageSkillOf(builtinStage("demo", []))).toBe("flow-demo");
  });

  it("снятый виджет и шаги вместо виджета оставляют этап без навыка", () => {
    expect(withoutWidget(cleared, "Демонстрация").skill).toBe("");
    expect(addCommit(cleared).skill).toBe("");
  });

  it("в инструкциях агенту этап идёт без навыка, вид этапа остаётся", () => {
    const line = (stageInstructions([cleared]) ?? "").split("\n")[1] ?? "";
    expect(line).not.toContain("skill");
    expect(line).toContain("ask_decision");
    expect(stageInstructions([builtinStage("demo", [])])).toContain("skill flow-demo: load it");
  });
});
