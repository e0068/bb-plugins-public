// @vitest-environment node
// Два вида этапов: агентские — их ведут агенты, workflow или виджет, — и скрипты — шаги, которые исполняет Flow.
import { describe, expect, it } from "vitest";

import { actionStage, automationStage, builtinStage } from "../lib/stage-constants";
import type { StageTemplate, WorkStage } from "../shared/contract";
import { isScriptStage } from "./stage-execution";
import { templatesOfKind } from "./stage-templates";

const skill: WorkStage = { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] };
const script: WorkStage = { id: "ship", kind: "skill", skill: "", name: "Ship", executors: [], automation: { source: "flow", steps: [] } };

describe("вид этапа", () => {
  it("скрипт — шаги Flow, Action и автоматизация Automations, даже без шагов", () => {
    expect([script, actionStage([]), automationStage({ id: "release", name: "Release" })].map(isScriptStage)).toEqual([true, true, true]);
  });

  it("агентский — навык с исполнителями или без и виджет", () => {
    expect([skill, builtinStage("questions", [])].map(isScriptStage)).toEqual([false, false]);
  });
});

describe("шаблоны по видам", () => {
  const { id: _a, ...agentTemplate } = skill;
  const { id: _s, ...scriptTemplate } = script;
  const templates: StageTemplate[] = [scriptTemplate, agentTemplate, { ...scriptTemplate, name: "Deploy" }];

  it("каждый вид получает свои шаблоны с их местом в общем списке", () => {
    expect(templatesOfKind(templates, true).map(({ template, index }) => [template.name, index])).toEqual([["Ship", 0], ["Deploy", 2]]);
    expect(templatesOfKind(templates, false).map(({ template, index }) => [template.name, index])).toEqual([["Spec", 1]]);
  });
});
