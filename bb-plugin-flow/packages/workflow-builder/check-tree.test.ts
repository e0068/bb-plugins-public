import { describe, expect, it } from "vitest";
import { checkTree, compile, recognize } from "./model";

// checkTree is the gate between an agent's JSON and the compiler: it either returns a full tree, every
// missing optional field filled with its default, or names every problem by the node's path — it never
// throws, and a tree it accepts compiles to a file the builder recognizes.

const agent = (extra: Record<string, unknown> = {}) => ({ type: "agent", label: "writer", prompt: "Write {{args}}", agentType: "implementer", ...extra });

const valid = () => ({
  name: "write-review",
  description: "Writes, then reviews",
  phases: [
    { title: "Write", steps: [agent()] },
    { title: "Review", mode: "parallel", steps: [agent({ label: "a" }), { type: "container", mode: "pipeline", steps: [agent({ label: "b" }), agent({ label: "c" })] }] },
  ],
});

describe("checkTree", () => {
  it("accepts a minimal tree and fills the defaults", () => {
    const result = checkTree(valid());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tree.phases[0].mode).toBe("single");
    expect(result.tree.phases[0].steps[0]).toMatchObject({ type: "agent", model: "", effort: "", schema: "", repeat: null });
  });

  it("an accepted tree compiles to a file the builder recognizes", () => {
    const result = checkTree(valid());
    if (!result.ok) throw new Error(result.problems.join("; "));
    for (const engine of ["bb", "claude"] as const) expect(recognize(compile(result.tree, engine), engine).kind).toBe("tree");
  });

  it("rejects what is not an object", () => {
    for (const value of [null, 3, "tree", []]) {
      const result = checkTree(value);
      expect(result.ok).toBe(false);
    }
  });

  it("names a missing phase list", () => {
    const result = checkTree({ name: "x", description: "" });
    expect(result).toEqual({ ok: false, problems: ["phases: must be a non-empty array"] });
  });

  it("names every bad node by its path", () => {
    const tree = valid();
    (tree.phases[1].steps[0] as Record<string, unknown>).prompt = 7;
    (tree.phases[1].steps[1] as Record<string, unknown>).mode = "loop";
    (tree.phases[0] as Record<string, unknown>).mode = "sometimes";
    const result = checkTree(tree);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual([
      'phases[0].mode: must be "single", "parallel" or "pipeline"',
      "phases[1].steps[0].prompt: must be a string",
      'phases[1].steps[1].mode: must be "parallel" or "pipeline"',
    ]);
  });

  it("rejects a step of unknown type and an empty step list", () => {
    const tree = valid();
    (tree.phases[0] as Record<string, unknown>).steps = [];
    (tree.phases[1].steps as unknown[])[0] = { type: "loop" };
    const result = checkTree(tree);
    expect(result).toEqual({
      ok: false,
      problems: ["phases[0].steps: must be a non-empty array", 'phases[1].steps[0].type: must be "agent" or "container"'],
    });
  });

  it("rejects a name the file system can't take", () => {
    const result = checkTree({ ...valid(), name: "Write Review" });
    expect(result).toEqual({ ok: false, problems: ["name: lowercase latin letters, digits and hyphens, e.g. review-changes"] });
  });
});
