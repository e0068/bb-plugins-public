// @vitest-environment node
import { describe, expect, it } from "vitest";

import { actionStage, automationStage, builtinStage, NEW_STAGE_NAMES } from "../lib/stage-constants";
import type { StageExecutor, WorkStage } from "../shared/contract";
import { builtinAutomationStage } from "./automation-run";
import { executionOf, withExecutor, withoutWidget, withRun, withSteps, withWidget } from "./stage-execution";

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer" };
const dev: StageExecutor = { id: "workflow:DEV1", kind: "workflow", name: "DEV1" };

const skillStage = (over: Partial<WorkStage> = {}): WorkStage => ({ id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [], ...over });
const questions = builtinStage("questions", []);
const script: WorkStage = { ...builtinAutomationStage([]), id: "ship", name: "Ship", automation: { source: "flow", steps: ["git.commit"], undo: ["git.commit"] } };
const action: WorkStage = { ...actionStage([]), automation: { source: "flow", steps: ["bb.archive"] } };
const external = automationStage({ id: "release", name: "Release" });

const addCommit = withSteps((automation) => ({ ...automation, steps: [...automation.steps, "git.commit"] }));

describe("чем исполняется этап", () => {
  it("этап навыка — его исполнители, этап вида — виджет, шаги Flow — скрипт, Action — скрипт по кнопке, Automations — чужой скрипт", () => {
    expect(executionOf(skillStage({ executors: [reviewer] }))).toEqual({ kind: "executors", executors: [reviewer] });
    expect(executionOf(questions)).toEqual({ kind: "widget", widget: "questions" });
    expect(executionOf(script)).toEqual({ kind: "script", automation: script.automation, manual: false });
    expect(executionOf(action)).toEqual({ kind: "script", automation: action.automation, manual: true });
    expect(executionOf(external)).toEqual({ kind: "external", automation: external.automation });
  });
});

describe("агент или workflow", () => {
  it("на этапе навыка ставится и снимается, соседние исполнители остаются", () => {
    const one = withExecutor(skillStage({ executors: [dev] }), reviewer, "Spec");
    expect(one.executors).toEqual([dev, reviewer]);
    expect(withExecutor(one, reviewer, "Spec").executors).toEqual([dev]);
  });

  it("на виджете делает этап навыком с навыком вида и видимым названием", () => {
    expect(withExecutor(questions, reviewer, "Вопросы")).toEqual({ id: questions.id, kind: "skill", skill: "flow-questions", name: "Вопросы", executors: [reviewer] });
  });

  it("на скрипте снимает шаги и запуск кнопкой, этап становится навыком без навыка", () => {
    const next = withExecutor(action, reviewer, "Обновить плагины");
    expect(next).toEqual({ id: action.id, kind: "skill", skill: "", name: "Обновить плагины", executors: [reviewer] });
    expect(executionOf(next).kind).toBe("executors");
  });

  it("под-этап остаётся под-этапом", () => {
    expect(withExecutor({ ...questions, parent: "spec" }, reviewer, "Вопросы").parent).toBe("spec");
  });
});

describe("виджет", () => {
  it("на этапе навыка ставит вид, снимает исполнителей и оставляет свой навык", () => {
    expect(withWidget(skillStage({ executors: [reviewer] }), "criteria")).toEqual({ id: "spec", kind: "criteria", skill: "spec", name: "Spec", executors: [] });
  });

  it("пустой навык и навык другого вида становятся навыком нового вида", () => {
    expect(withWidget(skillStage({ skill: "" }), "demo").skill).toBe("");
    expect(withWidget(questions, "demo")).toMatchObject({ kind: "demo", skill: "" });
    expect(withWidget(skillStage({ skill: "flow-questions" }), "demo").skill).toBe("");
  });

  it("название вида по умолчанию переходит на название нового вида, своё остаётся", () => {
    expect(withWidget(questions, "select").name).toBe(builtinStage("select", []).name);
    expect(withWidget({ ...questions, name: "Мои вопросы" }, "select").name).toBe("Мои вопросы");
  });

  it("на скрипте снимает шаги", () => {
    const next = withWidget(script, "demo");
    expect(next.automation).toBeUndefined();
    expect(executionOf(next)).toEqual({ kind: "widget", widget: "demo" });
  });
});

describe("шаги скрипта", () => {
  it("на скрипте правят его автоматизацию, откат и запуск кнопкой остаются", () => {
    const next = addCommit(action);
    expect(next.kind).toBe("action");
    expect(next.automation).toEqual({ source: "flow", steps: ["bb.archive", "git.commit"] });
    expect(withSteps((a) => a)(script).automation).toEqual(script.automation);
  });

  it("на этапе навыка снимают навык и исполнителей, этап запускает Flow сам", () => {
    expect(addCommit(skillStage({ executors: [reviewer] }))).toEqual({ id: "spec", kind: "skill", skill: "", name: "Spec", executors: [], automation: { source: "flow", steps: ["git.commit"] } });
  });

  it("на виджете снимают вид", () => {
    expect(executionOf(addCommit(questions))).toEqual({ kind: "script", automation: { source: "flow", steps: ["git.commit"] }, manual: false });
  });
});

describe("запуск скрипта", () => {
  it("кнопкой владельца — этап Action, сам — автоматизация; шаги не теряются", () => {
    const manual = withRun(script, true);
    expect(manual.kind).toBe("action");
    expect(manual.automation).toEqual(script.automation);
    expect(withRun(manual, false)).toEqual(script);
  });

  it("на этапе без шагов ставит пустой скрипт с выбранным запуском", () => {
    expect(executionOf(withRun(skillStage(), true))).toEqual({ kind: "script", automation: { source: "flow", steps: [] }, manual: true });
  });
});

describe("виджет снят", () => {
  it("этап навыка с навыком вида, видимым названием и без исполнителей", () => {
    expect(withoutWidget({ ...questions, parent: "spec" }, "Вопросы")).toEqual({ id: questions.id, parent: "spec", kind: "skill", skill: "flow-questions", name: "Вопросы", executors: [] });
    expect(withoutWidget({ ...questions, skill: "my-questions" }, "Вопросы").skill).toBe("my-questions");
  });
});

describe("новый этап", () => {
  it("виджет подписывает этап, который владелец ещё не назвал, на любом языке интерфейса", () => {
    for (const name of Object.values(NEW_STAGE_NAMES)) expect(withWidget(skillStage({ skill: "", name }), "demo").name).toBe(builtinStage("demo", []).name);
  });
});
