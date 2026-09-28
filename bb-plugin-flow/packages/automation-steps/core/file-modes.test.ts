import { describe, expect, it } from "vitest";
import { executablePaths, STAGE_ARGS } from "./file-modes";

const entry = (mode: string, path: string) => `${mode} 0123456789abcdef0123456789abcdef01234567 0\t${path}\0`;

describe("executablePaths", () => {
  it("a file staged as 100755 is executable", () => {
    expect([...executablePaths(entry("100755", "shell.command"))]).toEqual(["shell.command"]);
  });

  it("regular files, symlinks and submodules are not executable", () => {
    const out = entry("100644", "a.ts") + entry("120000", "link") + entry("160000", "vendor/sub");
    expect(executablePaths(out).size).toBe(0);
  });

  it("paths with spaces, tabs and newlines survive -z output intact", () => {
    const out = entry("100755", "dir name/run me.sh") + entry("100755", "odd\tname\nx");
    expect(executablePaths(out)).toEqual(new Set(["dir name/run me.sh", "odd\tname\nx"]));
  });

  it("empty output — no executable files", () => {
    expect(executablePaths("").size).toBe(0);
  });

  it("the git command lists the index with NUL-separated paths", () => {
    expect(STAGE_ARGS).toEqual(["ls-files", "--stage", "-z"]);
  });
});
