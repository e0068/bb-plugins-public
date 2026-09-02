import { describe, expect, it } from "vitest";
import { runFastForward, type GitPorts, type GitRun } from "./fast-forward";

// Fake run: queues replies by argv + records calls. The reply is picked by a
// function based on the first argument (fetch/merge), no real git runs.
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
const aheadZero: GitRun = { code: 0, stdout: "0\n", stderr: "" };

describe("runFastForward", () => {
  it("success: fetch → live ahead=0 → merge --ff-only, in that order", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? aheadZero : ok,
    );
    await runFastForward(ports, "main");
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
      ["merge", "--ff-only", "origin/main"],
    ]);
  });

  it("fetch failed → throws and nothing further runs", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "fetch" ? { code: 1, stdout: "", stderr: "no network" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow("no network");
    expect(calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("live ahead > 0 → readable plugin refusal, merge does not run", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 0, stdout: "2\n", stderr: "" } : ok,
    );
    await expect(runFastForward(ports, "main")).rejects.toThrow(
      "Fast-forward is not possible right now (diverged).",
    );
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
    ]);
  });

  it("rev-list failed or gave a non-number → does not block, proceeds to merge as before", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 1, stdout: "", stderr: "boom" } : ok,
    );
    await runFastForward(ports, "main");
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
      ["merge", "--ff-only", "origin/main"],
    ]);
  });

  it("merge is not a fast-forward (diverged, the live check missed it) → throws with git's text", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "rev-list") return aheadZero;
      if (args[0] === "merge") {
        return { code: 128, stdout: "", stderr: "Not possible to fast-forward, aborting." };
      }
      return ok;
    });
    await expect(runFastForward(ports, "main")).rejects.toThrow(
      "Not possible to fast-forward",
    );
  });

  it("no stderr falls back to stdout, otherwise the exit code", async () => {
    const { ports } = fakePorts((args) => {
      if (args[0] === "rev-list") return aheadZero;
      if (args[0] === "merge") return { code: 128, stdout: "", stderr: "" };
      return ok;
    });
    await expect(runFastForward(ports, "main")).rejects.toThrow("code 128");
  });
});
