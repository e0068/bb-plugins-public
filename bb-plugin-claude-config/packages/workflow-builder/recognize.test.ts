import { describe, expect, it } from "vitest";
import { blankAgent, blankPhase, blankTree, compile, parse, recognize, type Tree } from "./model";

// The builder opens a file as a tree only when it can prove the tree reproduces the file byte for byte.
// When it can't, the owner sees why: the file was written by hand (no builder mark), or it was built by
// the builder and then edited by hand (the mark is there, the body no longer matches).

const tree = (): Tree => {
  const t = blankTree("review");
  t.description = "Reviews a change";
  t.phases = [{ ...blankPhase("Review"), steps: [{ ...blankAgent(), label: "reviewer", prompt: "Review {{args}}", agentType: "reviewer" }] }];
  return t;
};

describe("recognize", () => {
  it("a file the builder compiled is a tree, for both engines", () => {
    for (const engine of ["bb", "claude"] as const) {
      const result = recognize(compile(tree(), engine), engine);
      expect(result.kind).toBe("tree");
    }
  });

  it("a hand-written file without the builder mark is hand-written", () => {
    const source = 'export const meta = { name: "epic", description: "x" }\nphase("A")\nawait agent("do it")\n';
    expect(recognize(source, "claude")).toEqual({ kind: "hand-written" });
  });

  it("a prompt edited by hand is read back as the new prompt — the body is the source of truth", () => {
    const source = compile(tree(), "claude").replace("`Review ", "`Review it all ");
    const result = recognize(source, "claude");
    expect(result.kind).toBe("tree");
    if (result.kind === "tree") expect(result.tree.phases[0].steps[0]).toMatchObject({ prompt: "Review it all {{args}}" });
  });

  it("a compiled file with a hand-added line between phases is edited", () => {
    const compiled = compile(tree(), "claude");
    const source = compiled.replace("\n// Made with Claude Config", "\nconsole.log('done')\n// Made with Claude Config");
    expect(recognize(source, "claude")).toEqual({ kind: "edited" });
  });

  it("parse stays the tree-or-null view of recognize", () => {
    const compiled = compile(tree(), "claude");
    expect(parse(compiled, "claude")).toEqual((recognize(compiled, "claude") as { tree: Tree }).tree);
    expect(parse("export const meta = {}\n", "claude")).toBeNull();
  });

  it("an empty file is hand-written", () => {
    expect(recognize("", "bb")).toEqual({ kind: "hand-written" });
  });
});
