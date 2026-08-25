import { describe, expect, it } from "vitest";
import {
  resolveSourceAbsPath,
  revealInFinder,
  type RevealExecFile,
} from ".";

describe("resolveSourceAbsPath", () => {
  it("joins a repo-relative path onto the absolute repo root", () => {
    expect(
      resolveSourceAbsPath(
        "/Users/me/code/repo",
        "memory/tasks/backlog/foo.md",
      ),
    ).toBe("/Users/me/code/repo/memory/tasks/backlog/foo.md");
  });

  it("normalizes a root with a trailing slash", () => {
    expect(resolveSourceAbsPath("/Users/me/code/repo/", "foo.md")).toBe(
      "/Users/me/code/repo/foo.md",
    );
  });

  it("refuses a relative path that escapes the root via ..", () => {
    expect(
      resolveSourceAbsPath("/Users/me/code/repo", "../../etc/passwd"),
    ).toBeNull();
  });

  it("refuses a relative path that escapes via a sibling-prefixed segment", () => {
    // "/Users/me/code/repo-evil" starts with the root string but is not
    // inside it — the sep-suffixed startsWith check must reject it too.
    expect(
      resolveSourceAbsPath("/Users/me/code/repo", "../repo-evil/foo.md"),
    ).toBeNull();
  });
});

function fakeExecFile(error: Error | null): {
  execFile: RevealExecFile;
  calls: { file: string; args: readonly string[] }[];
} {
  const calls: { file: string; args: readonly string[] }[] = [];
  const execFile: RevealExecFile = (file, args, callback) => {
    calls.push({ file, args });
    callback(error);
  };
  return { execFile, calls };
}

describe("revealInFinder", () => {
  it("calls execFile with open -R <absPath> as argv, no shell", async () => {
    const { execFile, calls } = fakeExecFile(null);
    const result = await revealInFinder("/repo/memory/tasks/foo.md", {
      platform: "darwin",
      execFile,
    });
    expect(result).toEqual({ revealed: true, error: null });
    expect(calls).toEqual([
      { file: "open", args: ["-R", "/repo/memory/tasks/foo.md"] },
    ]);
  });

  it("refuses to run on a non-macOS platform without calling execFile", async () => {
    const { execFile, calls } = fakeExecFile(null);
    const result = await revealInFinder("/repo/memory/tasks/foo.md", {
      platform: "linux",
      execFile,
    });
    expect(result.revealed).toBe(false);
    expect(result.error).toMatch(/macOS/);
    expect(calls).toEqual([]);
  });

  it("surfaces an execFile error (e.g. ENOENT) instead of throwing", async () => {
    const { execFile } = fakeExecFile(new Error("spawn open ENOENT"));
    const result = await revealInFinder("/repo/missing.md", {
      platform: "darwin",
      execFile,
    });
    expect(result).toEqual({
      revealed: false,
      error: "spawn open ENOENT",
    });
  });
});
