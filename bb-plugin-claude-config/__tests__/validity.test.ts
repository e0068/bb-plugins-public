import { describe, expect, it } from "vitest";
import { blankAgent, blankContainer, blankPhase, blankTree, type Agent, type Tree } from "../src/workflow/workflow-model";
import { agentsMissingTemplate, isTreeValid } from "../src/workflow/validity";

const withTemplate = (agentType: string): Agent => ({ ...blankAgent(), agentType });

describe("agentsMissingTemplate", () => {
  it("an empty tree is valid", () => {
    const t: Tree = { name: "w", description: "", phases: [] };
    expect(agentsMissingTemplate(t)).toBe(0);
    expect(isTreeValid(t)).toBe(true);
  });

  it("an agent without a template counts, one with a template doesn't", () => {
    const phase = { ...blankPhase(), steps: [withTemplate(""), withTemplate("reviewer")] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(1);
    expect(isTreeValid(t)).toBe(false);
  });

  it("whitespace in agentType doesn't count as a template", () => {
    const phase = { ...blankPhase(), steps: [withTemplate("   ")] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(1);
  });

  it("recursion into groups: nested agents count, not the group itself", () => {
    const group = { ...blankContainer("parallel"), steps: [withTemplate(""), withTemplate("")] };
    const phase = { ...blankPhase(), steps: [withTemplate("planner"), group] };
    const t: Tree = { name: "w", description: "", phases: [phase] };
    expect(agentsMissingTemplate(t)).toBe(2);
  });

  it("all agents have a template → the tree is valid", () => {
    const group = { ...blankContainer("pipeline"), steps: [withTemplate("a"), withTemplate("b")] };
    const phase = { ...blankPhase(), steps: [withTemplate("c"), group] };
    const t: Tree = { ...blankTree("w"), phases: [phase] };
    expect(isTreeValid(t)).toBe(true);
  });
});
