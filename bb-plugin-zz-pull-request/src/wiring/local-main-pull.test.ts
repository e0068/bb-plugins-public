import { describe, expect, it } from "vitest";
import { runLocalMainPull } from "./local-main-pull";
import type { GitPorts, GitRun } from "./git-run";

function fakePorts(
  reply: (args: readonly string[]) => GitRun,
): { ports: GitPorts; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    ports: {
      async run(args) {
        calls.push([...args]);
        return reply(args);
      },
    },
  };
}

const ok: GitRun = { code: 0, stdout: "", stderr: "" };

const NOWHERE_CHECKED_OUT: GitRun = { code: 0, stdout: "", stderr: "" };

const CHECKED_OUT_AT_INTEGRATION_COPY: GitRun = {
  code: 0,
  stdout: [
    "worktree /Users/e0068/Documents/Projects/Kasimov",
    "HEAD 94e633dabc",
    "branch refs/heads/main",
    "",
    "worktree /Users/e0068/.bb/worktrees/env_gv72mszhtn/Kasimov",
    "HEAD c0f55e2abc",
    "branch refs/heads/bb/thr_fmj9w8m7nt",
    "",
  ].join("\n"),
  stderr: "",
};

describe("runLocalMainPull", () => {
  it("base is not checked out anywhere → direct fetch origin <base>:<base>", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "worktree" ? NOWHERE_CHECKED_OUT : ok,
    );
    await expect(runLocalMainPull(ports, "main")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["worktree", "list", "--porcelain"],
      ["fetch", "origin", "main:main"],
    ]);
  });

  it("base is checked out in another copy → fetch+merge --ff-only THERE (-C <path>), not a direct fetch into the ref", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "worktree" ? CHECKED_OUT_AT_INTEGRATION_COPY : ok,
    );
    await expect(runLocalMainPull(ports, "main")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["worktree", "list", "--porcelain"],
      ["-C", "/Users/e0068/Documents/Projects/Kasimov", "fetch", "origin", "main"],
      [
        "-C",
        "/Users/e0068/Documents/Projects/Kasimov",
        "merge",
        "--ff-only",
        "origin/main",
      ],
    ]);
  });

  it("the copy with the base has diverged (ff impossible) → ok: false with git's text, ref is not touched directly", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "worktree") return CHECKED_OUT_AT_INTEGRATION_COPY;
      if (args.includes("merge"))
        return { code: 128, stdout: "", stderr: "Not possible to fast-forward, aborting." };
      return ok;
    });
    const result = await runLocalMainPull(ports, "main");
    expect(result).toEqual({ ok: false, reason: "Not possible to fast-forward, aborting." });
  });

  it("uncommitted changes in the target copy → merge refuses, ok: false", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "worktree") return CHECKED_OUT_AT_INTEGRATION_COPY;
      if (args.includes("merge")) {
        return {
          code: 1,
          stdout: "",
          stderr: "error: Your local changes would be overwritten by merge.",
        };
      }
      return ok;
    });
    const result = await runLocalMainPull(ports, "main");
    expect(result.ok).toBe(false);
  });

  it("fetch in the target copy failed → merge does not run, ok: false", async () => {
    const { ports, calls } = fakePorts((args) => {
      if (args[0] === "worktree") return CHECKED_OUT_AT_INTEGRATION_COPY;
      if (args.includes("fetch")) return { code: 1, stdout: "", stderr: "no network" };
      return ok;
    });
    const result = await runLocalMainPull(ports, "main");
    expect(result).toEqual({ ok: false, reason: "no network" });
    expect(calls).toEqual([
      ["worktree", "list", "--porcelain"],
      ["-C", "/Users/e0068/Documents/Projects/Kasimov", "fetch", "origin", "main"],
    ]);
  });

  it("worktree list failed → falls back to a direct fetch into the ref", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "worktree" ? { code: 1, stdout: "", stderr: "boom" } : ok,
    );
    await expect(runLocalMainPull(ports, "main")).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ["worktree", "list", "--porcelain"],
      ["fetch", "origin", "main:main"],
    ]);
  });

  it("the ref is checked out only in the environment ITSELF (not found in the list) → the direct fetch also refuses safely", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "worktree") return NOWHERE_CHECKED_OUT;
      return {
        code: 128,
        stdout: "",
        stderr: "fatal: refusing to fetch into branch 'refs/heads/main' checked out at '/here'",
      };
    });
    const result = await runLocalMainPull(ports, "main");
    expect(result.ok).toBe(false);
  });

  it("no stderr falls back to stdout, otherwise the exit code", async () => {
    const { ports } = fakePorts((args) =>
      args[0] === "worktree" ? NOWHERE_CHECKED_OUT : { code: 128, stdout: "", stderr: "" },
    );
    await expect(runLocalMainPull(ports, "main")).resolves.toEqual({
      ok: false,
      reason: "code 128",
    });
  });
});
