import { describe, it, expect } from "vitest";
import {
  nodeAt,
  addStep,
  addPhase,
  removeNode,
  toggleMode,
  renameNode,
  setAgentField,
  applyTemplate,
} from "../src/workflow/outline-ops";
import { blankAgent, blankContainer, blankTree, type Agent, type Tree } from "../src/workflow/workflow-model";

function agent(over: Partial<Agent> = {}): Agent {
  return { ...blankAgent(), ...over };
}

// A tree with a nested container so paths can descend more than one level:
// phase 0 → [agent "a0", container "c0" → [agent "a1", agent "a2"]]
function nestedTree(): Tree {
  const t = blankTree("w");
  t.phases[0].title = "P1";
  t.phases[0].mode = "parallel";
  const container = blankContainer("parallel");
  container.title = "Group";
  container.steps = [agent({ label: "a1" }), agent({ label: "a2" })];
  t.phases[0].steps = [agent({ label: "a0" }), container];
  return t;
}

describe("nodeAt", () => {
  it("resolves a phase by [i]", () => {
    const t = nestedTree();
    expect(nodeAt(t, [0])).toBe(t.phases[0]);
  });

  it("resolves a nested step by [i, j, k]", () => {
    const t = nestedTree();
    const node = nodeAt(t, [0, 1, 1]);
    expect(node).toEqual(agent({ label: "a2" }));
  });

  it("returns null for an empty path", () => {
    expect(nodeAt(nestedTree(), [])).toBeNull();
  });

  it("returns null for a path past the end", () => {
    const t = nestedTree();
    expect(nodeAt(t, [5])).toBeNull();
    expect(nodeAt(t, [0, 5])).toBeNull();
    expect(nodeAt(t, [0, 1, 5])).toBeNull();
  });

  it("returns null when descending into an agent (no steps)", () => {
    expect(nodeAt(nestedTree(), [0, 0, 0])).toBeNull();
  });
});

describe("addStep", () => {
  it("adds a blank agent to a phase's steps", () => {
    const t = nestedTree();
    addStep(t, [0], "agent");
    const added = t.phases[0].steps[t.phases[0].steps.length - 1];
    expect(added.type).toBe("agent");
    expect(added).toEqual(blankAgent());
  });

  it("adds a group (parallel container with one blank agent) to a phase's steps", () => {
    const t = nestedTree();
    addStep(t, [0], "group");
    const added = t.phases[0].steps[t.phases[0].steps.length - 1];
    expect(added.type).toBe("container");
    if (added.type === "container") {
      expect(added.mode).toBe("parallel");
      expect(added.steps).toEqual([blankAgent()]);
    }
  });

  it("adds a step into a nested container's steps", () => {
    const t = nestedTree();
    addStep(t, [0, 1], "agent");
    const container = t.phases[0].steps[1];
    if (container.type === "container") {
      expect(container.steps).toHaveLength(3);
    }
  });

  it("is a no-op for an invalid basePath", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    addStep(t, [9], "agent");
    addStep(t, [0, 0], "agent"); // [0,0] is an agent — no steps to add to
    expect(t).toEqual(before);
  });
});

describe("addPhase", () => {
  it("adds a phase with mode parallel, title 'Phase N', one blank agent", () => {
    const t = blankTree("w");
    addPhase(t);
    const added = t.phases[t.phases.length - 1];
    expect(added.mode).toBe("parallel");
    expect(added.title).toBe("Phase " + t.phases.length);
    expect(added.steps).toEqual([blankAgent()]);
  });

  it("numbers subsequent phases by count", () => {
    const t = blankTree("w");
    addPhase(t);
    addPhase(t);
    expect(t.phases.map((p) => p.title)).toEqual(["Phase 1", "Phase 2", "Phase 3"]);
  });
});

describe("removeNode", () => {
  it("removes a phase for a path of length 1", () => {
    const t = nestedTree();
    addPhase(t);
    removeNode(t, [0]);
    expect(t.phases).toHaveLength(1);
    expect(t.phases[0].title).toBe("Phase 2");
  });

  it("removes a step from its parent for a longer path", () => {
    const t = nestedTree();
    removeNode(t, [0, 0]);
    expect(t.phases[0].steps).toHaveLength(1);
    expect(t.phases[0].steps[0].type).toBe("container");
  });

  it("removes a step nested inside a container", () => {
    const t = nestedTree();
    removeNode(t, [0, 1, 0]);
    const container = t.phases[0].steps[1];
    if (container.type === "container") {
      expect(container.steps).toEqual([agent({ label: "a2" })]);
    }
  });

  it("is a no-op for an invalid path", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    removeNode(t, []);
    removeNode(t, [9]);
    removeNode(t, [0, 9]);
    expect(t).toEqual(before);
  });
});

describe("toggleMode", () => {
  it("flips parallel to pipeline", () => {
    const t = nestedTree(); // phase 0 mode is parallel
    toggleMode(t, [0]);
    expect(t.phases[0].mode).toBe("pipeline");
  });

  it("flips pipeline to parallel", () => {
    const t = nestedTree();
    t.phases[0].mode = "pipeline";
    toggleMode(t, [0]);
    expect(t.phases[0].mode).toBe("parallel");
  });

  it("flips legacy single to parallel", () => {
    const t = nestedTree();
    t.phases[0].mode = "single";
    toggleMode(t, [0]);
    expect(t.phases[0].mode).toBe("parallel");
  });

  it("toggles a nested container's mode too", () => {
    const t = nestedTree();
    toggleMode(t, [0, 1]);
    const container = t.phases[0].steps[1];
    if (container.type === "container") expect(container.mode).toBe("pipeline");
  });

  it("is a no-op on an agent or an invalid path", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    toggleMode(t, [0, 0]); // agent has no mode
    toggleMode(t, [9]);
    expect(t).toEqual(before);
  });
});

describe("renameNode", () => {
  it("sets a phase's title", () => {
    const t = nestedTree();
    renameNode(t, [0], "Renamed");
    expect(t.phases[0].title).toBe("Renamed");
  });

  it("sets a container's title", () => {
    const t = nestedTree();
    renameNode(t, [0, 1], "New group name");
    const container = t.phases[0].steps[1];
    if (container.type === "container") expect(container.title).toBe("New group name");
  });

  it("is a no-op on an agent or an invalid path", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    renameNode(t, [0, 0], "nope");
    renameNode(t, [9], "nope");
    expect(t).toEqual(before);
  });
});

describe("setAgentField", () => {
  it("patches label/prompt/schema/model on an agent", () => {
    const t = nestedTree();
    setAgentField(t, [0, 0], { label: "L", prompt: "P", schema: "{}", model: "opus" });
    const a = t.phases[0].steps[0];
    expect(a).toEqual(agent({ label: "L", prompt: "P", schema: "{}", model: "opus" }));
  });

  it("is a no-op on a container or an invalid path", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    setAgentField(t, [0, 1], { label: "nope" }); // [0,1] is a container
    setAgentField(t, [9], { label: "nope" });
    expect(t).toEqual(before);
  });
});

describe("applyTemplate", () => {
  it("sets agentType/model/effort/provider without touching tools", () => {
    const t = nestedTree();
    (t.phases[0].steps[0] as Agent).tools = ["Read"];
    applyTemplate(t, [0, 0], "code-reviewer", { model: "opus", effort: "high", provider: "claude-code" });
    const a = t.phases[0].steps[0];
    expect(a).toEqual(
      agent({ label: "a0", agentType: "code-reviewer", model: "opus", effort: "high", provider: "claude-code", tools: ["Read"] }),
    );
  });

  it("is a no-op on a container or an invalid path", () => {
    const t = nestedTree();
    const before = JSON.parse(JSON.stringify(t));
    const info = { model: "opus", effort: "high", provider: "claude-code" };
    applyTemplate(t, [0, 1], "x", info); // [0,1] is a container
    applyTemplate(t, [9], "x", info);
    expect(t).toEqual(before);
  });
});
