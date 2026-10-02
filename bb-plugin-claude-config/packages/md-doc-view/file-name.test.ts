import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fileNameOf, renameProblem, siblingPath } from "./file-name";

describe("file name — what a rename may be called", () => {
  it("an empty or blank name is refused", () => {
    expect(renameProblem("", "/docs/a.md")).toBe("Name is empty.");
    expect(renameProblem("   ", "/docs/a.md")).toBe("Name is empty.");
  });

  it("a name with a slash is refused — it would move the file", () => {
    expect(renameProblem("sub/a.md", "/docs/a.md")).toBe("Name can't contain a slash.");
    expect(renameProblem("sub\\a.md", "/docs/a.md")).toBe("Name can't contain a slash.");
  });

  it("dot names are refused", () => {
    expect(renameProblem(".", "/docs/a.md")).toBe("Name can't be . or ..");
    expect(renameProblem("..", "/docs/a.md")).toBe("Name can't be . or ..");
  });

  it("the current name is refused", () => {
    expect(renameProblem("a.md", "/docs/a.md")).toBe("That's the current name.");
  });

  it("any other name is fine", () => {
    expect(renameProblem("b.md", "/docs/a.md")).toBeNull();
  });
});

describe("file name — paths", () => {
  it("the name of a file is its last segment", () => {
    expect(fileNameOf("/docs/a.md")).toBe("a.md");
    expect(fileNameOf("a.md")).toBe("a.md");
  });

  it("a fine name lands in the same folder and ends with that name", () => {
    const segment = fc.stringMatching(/^[a-z0-9_-]{1,8}(\.md)?$/);
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), segment, (dirs, name) => {
        const path = `/${dirs.join("/")}`;
        fc.pre(renameProblem(name, path) === null);
        const next = siblingPath(path, name);
        expect(next).toBe(`${path.slice(0, path.lastIndexOf("/"))}/${name}`);
        expect(fileNameOf(next)).toBe(name);
      }),
    );
  });
});
