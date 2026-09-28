import { describe, expect, it } from "vitest";
import type { ResolvedBase } from "../core/base-branch";
import { liveAheadCount, type GitPorts, type GitRun } from "./fast-forward";

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

const originMain: ResolvedBase = { mode: "origin", statusBase: "origin/main", githubBase: "main" };
const localMain: ResolvedBase = { mode: "local", statusBase: "main", githubBase: "main" };

describe("liveAheadCount — mode origin", () => {
  it("fetches first, then reports the live count — the fresh answer bb's status cache can miss", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 0, stdout: "2\n", stderr: "" } : ok,
    );
    expect(await liveAheadCount(ports, originMain)).toBe(2);
    expect(calls).toEqual([
      ["fetch", "origin", "main"],
      ["rev-list", "--count", "origin/main..HEAD"],
    ]);
  });

  it("fetch failed → null, no rev-list — the count can't be trusted without a fresh origin/<base>", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "fetch" ? { code: 1, stdout: "", stderr: "no network" } : ok,
    );
    expect(await liveAheadCount(ports, originMain)).toBeNull();
    expect(calls).toEqual([["fetch", "origin", "main"]]);
  });

  it("rev-list failed → null", async () => {
    const { ports } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 1, stdout: "", stderr: "boom" } : ok,
    );
    expect(await liveAheadCount(ports, originMain)).toBeNull();
  });

  it("non-numeric stdout → null", async () => {
    const { ports } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 0, stdout: "not a number\n", stderr: "" } : ok,
    );
    expect(await liveAheadCount(ports, originMain)).toBeNull();
  });
});

describe("liveAheadCount — mode local", () => {
  it("no fetch — counts straight against the bare local ref", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "rev-list" ? { code: 0, stdout: "3\n", stderr: "" } : ok,
    );
    expect(await liveAheadCount(ports, localMain)).toBe(3);
    expect(calls).toEqual([["rev-list", "--count", "main..HEAD"]]);
  });
});
