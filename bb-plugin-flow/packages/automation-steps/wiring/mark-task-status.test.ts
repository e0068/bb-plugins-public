import { describe, expect, it } from "vitest";
import { markLinkedTasksStatus, splitTaskStatusResults } from "./mark-task-status";
import type { CliPorts, CliRun } from "./bb-cli-run";

function fakePorts(
  reply: (args: readonly string[]) => CliRun,
): { ports: CliPorts; calls: string[][]; envs: (Record<string, string> | undefined)[] } {
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  return {
    calls,
    envs,
    ports: {
      async run(args, env) {
        calls.push([...args]);
        envs.push(env === undefined ? undefined : { ...env });
        return reply(args);
      },
    },
  };
}

const ok: CliRun = { kind: "ran", code: 0, stdout: "", stderr: "" };

function currentReply(tasks: readonly { key: string }[]): CliRun {
  return { kind: "ran", code: 0, stdout: JSON.stringify({ tasks }), stderr: "" };
}

describe("markLinkedTasksStatus", () => {
  it("no linked tasks → nothing marked, nothing unavailable, only `current` runs", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[0] === "tasks" && args[1] === "current" ? currentReply([]) : ok,
    );
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [],
    });
    expect(calls).toEqual([["tasks", "current", "--thread", "thr_abc", "--json"]]);
  });

  it("listing exits non-zero → nothing marked, still not reported as unavailable", async () => {
    const { ports, calls } = fakePorts(() => ({
      kind: "ran",
      code: 1,
      stdout: "",
      stderr: "boom",
    }));
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [],
    });
    expect(calls).toEqual([["tasks", "current", "--thread", "thr_abc", "--json"]]);
  });

  it("the CLI itself cannot be run → reported as unavailable with the reason, no update calls", async () => {
    const { ports, calls } = fakePorts(() => ({ kind: "unavailable", reason: "spawn bb ENOENT" }));
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: "spawn bb ENOENT",
      results: [],
    });
    expect(calls).toEqual([["tasks", "current", "--thread", "thr_abc", "--json"]]);
  });

  it("the given status reaches the `tasks update` call — in_review, not just done", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[1] === "current" ? currentReply([{ key: "BBPL-1" }]) : ok,
    );
    expect(await markLinkedTasksStatus(ports, "thr_abc", "in_review")).toEqual({
      unavailable: null,
      results: [{ key: "BBPL-1", ok: true }],
    });
    expect(calls).toEqual([
      ["tasks", "current", "--thread", "thr_abc", "--json"],
      ["tasks", "update", "BBPL-1", "--status", "in_review", "--json"],
    ]);
  });
});

describe("splitTaskStatusResults", () => {
  it("no results → both lists empty", () => {
    expect(splitTaskStatusResults([])).toEqual({ successKeys: [], failedTasks: [] });
  });

  it("mix of ok and failed → each sorted into its own list, order preserved", () => {
    expect(
      splitTaskStatusResults([
        { key: "BBPL-1", ok: true },
        { key: "BBPL-2", ok: false, reason: "not found" },
        { key: "BBPL-3", ok: true },
      ]),
    ).toEqual({
      successKeys: ["BBPL-1", "BBPL-3"],
      failedTasks: [{ key: "BBPL-2", reason: "not found" }],
    });
  });
});
