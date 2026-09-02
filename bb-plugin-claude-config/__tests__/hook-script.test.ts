import { describe, expect, it } from "vitest";

import { extractCommandFile } from "../src/hook-script";

describe("extractCommandFile", () => {
  it("takes the file the command reads (not just a script by extension)", () => {
    expect(
      extractCommandFile("cat /Users/e0068/.claude/output-checklist.json"),
    ).toBe("/Users/e0068/.claude/output-checklist.json");
  });

  it("takes the script path, stripping the interpreter and flags", () => {
    expect(extractCommandFile("bash ~/.claude/hooks/foo.sh --flag")).toBe(
      "~/.claude/hooks/foo.sh",
    );
    expect(extractCommandFile("node ./scripts/hook.mjs")).toBe(
      "./scripts/hook.mjs",
    );
  });

  it("preserves environment placeholders in the path", () => {
    expect(
      extractCommandFile('$CLAUDE_PROJECT_DIR/.claude/hooks/x.py "$1"'),
    ).toBe("$CLAUDE_PROJECT_DIR/.claude/hooks/x.py");
  });

  it("direct file execution without an interpreter", () => {
    expect(extractCommandFile("/abs/path/check.py")).toBe("/abs/path/check.py");
  });

  it("strips quotes from the path token", () => {
    expect(extractCommandFile("bash '~/hooks/check.sh'")).toBe(
      "~/hooks/check.sh",
    );
  });

  it("an inline command without a file argument → null", () => {
    expect(extractCommandFile("jq -r '.tool_input.command'")).toBeNull();
    expect(extractCommandFile('echo "hello"')).toBeNull();
    expect(extractCommandFile("bash -c 'exit 0'")).toBeNull();
  });

  it("a bare file name without a path isn't treated as a file (no separator)", () => {
    expect(extractCommandFile("echo build.sh done")).toBeNull();
  });
});
