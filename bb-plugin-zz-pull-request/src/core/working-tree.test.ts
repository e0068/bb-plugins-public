import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideWorkingTree, workingTreeStatusArgs } from "./working-tree";

describe("workingTreeStatusArgs", () => {
  it("asks git for the machine-readable short status", () => {
    expect(workingTreeStatusArgs()).toEqual(["status", "--porcelain"]);
  });
});

describe("decideWorkingTree", () => {
  it("no output → clean", () => {
    expect(decideWorkingTree({ code: 0, stdout: "" })).toBe("clean");
  });

  it("whitespace-only output → clean, git prints a trailing newline", () => {
    expect(decideWorkingTree({ code: 0, stdout: "\n" })).toBe("clean");
  });

  it("a modified file → dirty", () => {
    expect(decideWorkingTree({ code: 0, stdout: " M server.ts\n" })).toBe("dirty");
  });

  it("an untracked file → dirty, archiving would bury it just the same", () => {
    expect(decideWorkingTree({ code: 0, stdout: "?? notes.md\n" })).toBe("dirty");
  });

  it("git failed → unknown, not \"clean\"", () => {
    expect(decideWorkingTree({ code: 128, stdout: "" })).toBe("unknown");
  });

  it("invariant: a non-zero exit is never read as a verdict about the tree", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 255 }), fc.string(), (code, stdout) => {
        expect(decideWorkingTree({ code, stdout })).toBe("unknown");
      }),
    );
  });

  it("invariant: on success the verdict is exactly \"is there any output\"", () => {
    fc.assert(
      fc.property(fc.string(), (stdout) => {
        const expected = stdout.trim() === "" ? "clean" : "dirty";
        expect(decideWorkingTree({ code: 0, stdout })).toBe(expected);
      }),
    );
  });
});
