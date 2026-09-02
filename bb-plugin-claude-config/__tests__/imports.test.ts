import { describe, expect, it } from "vitest";

import { parseImports, resolveImportPath } from "../src/imports";

describe("parseImports", () => {
  it("finds a relative import with an extension", () => {
    expect(parseImports("See @AGENTS.md for the rules.")).toEqual(["AGENTS.md"]);
  });

  it("finds an import from the home directory", () => {
    expect(parseImports("@~/.claude/skills/x/SKILL.md")).toEqual([
      "~/.claude/skills/x/SKILL.md",
    ]);
  });

  it("finds an explicitly relative import ./", () => {
    expect(parseImports("@./rel/y.md")).toEqual(["./rel/y.md"]);
  });

  it("doesn't confuse an e-mail address with an import", () => {
    expect(parseImports("Write to user@example.com for help.")).toEqual([]);
  });

  it("collapses exact duplicates, keeping the first occurrence", () => {
    expect(parseImports("@AGENTS.md and again @AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  it("ignores lines inside fenced code blocks", () => {
    const text = ["text @AGENTS.md", "```", "@fake.md inside the block", "```", "@REAL.md"].join(
      "\n",
    );
    expect(parseImports(text)).toEqual(["AGENTS.md", "REAL.md"]);
  });

  it("trims trailing punctuation", () => {
    expect(parseImports("see @AGENTS.md.")).toEqual(["AGENTS.md"]);
    expect(parseImports("(see @AGENTS.md)")).toEqual(["AGENTS.md"]);
    expect(parseImports("@AGENTS.md,")).toEqual(["AGENTS.md"]);
  });

  it("an import at the start of a line is recognized without a space before it", () => {
    expect(parseImports("@AGENTS.md")).toEqual(["AGENTS.md"]);
  });

  it("a token that doesn't look like a file isn't treated as an import", () => {
    expect(parseImports("Version @2 of the release")).toEqual([]);
  });

  it("empty text — empty list", () => {
    expect(parseImports("")).toEqual([]);
  });
});

describe("resolveImportPath", () => {
  const home = "/Users/vs";
  const fromFile = "/Users/vs/project/CLAUDE.md";

  it("expands ~ from the home directory", () => {
    expect(resolveImportPath(fromFile, "~/.claude/skills/x/SKILL.md", home)).toBe(
      "/Users/vs/.claude/skills/x/SKILL.md",
    );
  });

  it("a bare ~ resolves to the home directory itself", () => {
    expect(resolveImportPath(fromFile, "~", home)).toBe("/Users/vs");
  });

  it("an absolute path is returned as-is (normalized)", () => {
    expect(resolveImportPath(fromFile, "/etc/hosts", home)).toBe("/etc/hosts");
  });

  it("a relative path is resolved from the source file's directory", () => {
    expect(resolveImportPath(fromFile, "./AGENTS.md", home)).toBe(
      "/Users/vs/project/AGENTS.md",
    );
    expect(resolveImportPath(fromFile, "../shared/rules.md", home)).toBe(
      "/Users/vs/shared/rules.md",
    );
  });

  it("a bare name without ./ is also relative to the source file's directory", () => {
    expect(resolveImportPath(fromFile, "AGENTS.md", home)).toBe(
      "/Users/vs/project/AGENTS.md",
    );
  });
});
