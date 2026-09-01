import { describe, expect, it } from "vitest";
import { blankAgent, blankContainer, blankPhase, blankTree, type Agent, type Tree } from "../src/workflow/workflow-model";
import { agentsMissingTemplate, isTreeValid } from "../src/workflow/validity";

const withTemplate = (agentType: string): Agent => ({ ...blankAgent(), agentType });

describe("agentsMissingTemplate", () => {
  it("пустое дерево валидно", () => {
    const t: Tree = { name: "w", description: "", phases: [] };
    expect(agentsMissingTemplate(t)).toBe(0);
    expect(isTreeValid(t)).toBe(true);
  });

  it("агент без шаблона считается, с шаблоном — нет", () => {
    const phase = { ...blankPhase(), steps: [withTemplate(""), withTemplate("reviewer")] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(1);
    expect(isTreeValid(t)).toBe(false);
  });

  it("пробелы в agentType не считаются шаблоном", () => {
    const phase = { ...blankPhase(), steps: [withTemplate("   ")] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(1);
  });

  it("рекурсия в группы: считаются вложенные агенты, не сама группа", () => {
    const group = { ...blankContainer("parallel"), steps: [withTemplate(""), withTemplate("")] };
    const phase = { ...blankPhase(), steps: [withTemplate("planner"), group] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(2);
  });

  it("все агенты с шаблоном → дерево валидно", () => {
    const group = { ...blankContainer("pipeline"), steps: [withTemplate("a"), withTemplate("b")] };
    const phase = { ...blankPhase(), steps: [withTemplate("c"), group] };
    const t: Tree = { ...blankTree("w"), phases: [phase] };
    expect(isTreeValid(t)).toBe(true);
  });
});
