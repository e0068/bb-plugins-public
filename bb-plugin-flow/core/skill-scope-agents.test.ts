// @vitest-environment node
// Агенты плагинов и встроенные агенты под переключателем агентов — как свои.
import { describe, expect, it } from "vitest";

import type { StageCatalog } from "../shared/contract";
import { agentsNamedIn, BUILTIN_AGENTS, hiddenOf } from "./skill-scope";

const catalog: StageCatalog = {
  skills: [{ name: "pr-review-toolkit:review-pr", origin: { kind: "plugin", plugin: "pr-review-toolkit", provider: "claude-code" } }],
  executors: [
    { id: "agent:pr-review-toolkit:code-reviewer", kind: "agent", name: "pr-review-toolkit:code-reviewer", origin: { kind: "plugin", plugin: "pr-review-toolkit" } },
    { id: "agent:pr-review-toolkit:pr-test-analyzer", kind: "agent", name: "pr-review-toolkit:pr-test-analyzer", origin: { kind: "plugin", plugin: "pr-review-toolkit" } },
  ],
};
const plugins = [{ key: "pr-review-toolkit@official", name: "pr-review-toolkit" }];

describe("агенты плагинов под переключателем агентов", () => {
  it("плагин нужен позднему этапу — он включён, но его агенты до этого этапа спрятаны", () => {
    const needed = { skills: [], agents: ["pr-review-toolkit:code-reviewer"] };
    const hidden = hiddenOf({ catalog, plugins, limits: { skills: true, agents: true }, opened: { skills: [], agents: [] }, needed });
    expect(hidden.plugins).toEqual([]);
    expect(hidden.agents).toEqual(expect.arrayContaining(["pr-review-toolkit:code-reviewer", "pr-review-toolkit:pr-test-analyzer"]));
  });

  it("открытый агент плагина виден, соседний — нет", () => {
    const opened = { skills: [], agents: ["pr-review-toolkit:code-reviewer"] };
    const hidden = hiddenOf({ catalog, plugins, limits: { skills: false, agents: true }, opened, needed: opened });
    expect(hidden.agents).toContain("pr-review-toolkit:pr-test-analyzer");
    expect(hidden.agents).not.toContain("pr-review-toolkit:code-reviewer");
  });

  it("встроенные агенты в скрипте workflow узнаются по тем же именам", () => {
    expect(agentsNamedIn("agent(p, { agentType: 'Explore' })", BUILTIN_AGENTS)).toEqual(["Explore"]);
  });
});
