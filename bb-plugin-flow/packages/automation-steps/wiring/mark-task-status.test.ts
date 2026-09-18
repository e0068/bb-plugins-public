import { describe, expect, it } from "vitest";
import { markLinkedTasksStatus, splitTaskStatusResults } from "./mark-task-status";
import type { CliPorts, CliRun } from "./bb-cli-run";

function fakePorts(
  reply: (args: readonly string[]) => CliRun,
): { ports: CliPorts; calls: string[][] } {
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

  it("one linked task, update succeeds → marked done, in order", async () => {
    const { ports, calls } = fakePorts((args) =>
      args[1] === "current" ? currentReply([{ key: "BBPL-1" }]) : ok,
    );
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [{ key: "BBPL-1", ok: true }],
    });
    expect(calls).toEqual([
      ["tasks", "current", "--thread", "thr_abc", "--json"],
      ["tasks", "update", "BBPL-1", "--status", "done", "--json"],
    ]);
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

  it("several linked tasks, one update fails → per-task result with the failure reason, the rest still attempted", async () => {
    const { ports } = fakePorts((args) => {
      if (args[1] === "current") return currentReply([{ key: "BBPL-1" }, { key: "BBPL-2" }]);
      if (args[1] === "update" && args[2] === "BBPL-2") {
        return { kind: "ran", code: 1, stdout: "", stderr: "not found" };
      }
      return ok;
    });
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [
        { key: "BBPL-1", ok: true },
        { key: "BBPL-2", ok: false, reason: "not found" },
      ],
    });
  });

  it("a failed update with no stderr falls back to stdout, otherwise the exit code — same as cliRunMessage", async () => {
    const { ports } = fakePorts((args) => {
      if (args[1] === "current") return currentReply([{ key: "BBPL-1" }]);
      return { kind: "ran", code: 3, stdout: "", stderr: "" };
    });
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [{ key: "BBPL-1", ok: false, reason: "code 3" }],
    });
  });

  it("the CLI disappears between listing and updating → that task fails with the spawn reason", async () => {
    const { ports } = fakePorts((args) =>
      args[1] === "current"
        ? currentReply([{ key: "BBPL-1" }])
        : { kind: "unavailable", reason: "spawn bb ENOENT" },
    );
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [{ key: "BBPL-1", ok: false, reason: "spawn bb ENOENT" }],
    });
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
