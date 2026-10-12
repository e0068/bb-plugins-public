import { describe, expect, it } from "vitest";
import { markLinkedTasksStatus } from "./mark-task-status";
import type { CliPorts, CliRun } from "./bb-cli-run";

type Sub = { key: string; status: string };
type Tree = Record<string, Sub[]>;

const ok: CliRun = { kind: "ran", code: 0, stdout: "", stderr: "" };
const json = (value: unknown): CliRun => ({ kind: "ran", code: 0, stdout: JSON.stringify(value), stderr: "" });

/** Fake `bb`: `current` lists `linked`, `show K` answers K's sub-tasks from `tree`, `update` fails for keys in `refuse`. */
function fakeBb(linked: string[], tree: Tree, refuse: string[] = []) {
  const calls: string[][] = [];
  const envs: (Record<string, string> | undefined)[] = [];
  const ports: CliPorts = {
    async run(args, env) {
      calls.push([...args]);
      envs.push(env === undefined ? undefined : { ...env });
      if (args[1] === "current") return json({ tasks: linked.map((key) => ({ key })) });
      if (args[1] === "show") return json({ subtasks: tree[args[2]!] ?? [] });
      if (args[1] === "update" && refuse.includes(args[2]!)) return { kind: "ran", code: 1, stdout: "", stderr: "refused" };
      return ok;
    },
  };
  return { ports, calls, envs, updates: () => calls.filter((c) => c[1] === "update").map((c) => c[2]) };
}

describe("markLinkedTasksStatus → done closes the whole tree", () => {
  it("a task without sub-tasks is marked as before", async () => {
    const bb = fakeBb(["BBPL-1"], {});
    expect(await markLinkedTasksStatus(bb.ports, "thr_abc", "done")).toEqual({ unavailable: null, results: [{ key: "BBPL-1", ok: true }] });
    expect(bb.calls).toEqual([
      ["tasks", "current", "--thread", "thr_abc", "--json"],
      ["tasks", "show", "BBPL-1", "--json"],
      ["tasks", "update", "BBPL-1", "--status", "done", "--json"],
    ]);
  });

  it("sub-tasks of any depth go to done before their parent, deepest first", async () => {
    const bb = fakeBb(["P-1"], {
      "P-1": [{ key: "P-2", status: "in_progress" }, { key: "P-3", status: "backlog" }],
      "P-2": [{ key: "P-4", status: "todo" }],
    });
    const report = await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-4", "P-2", "P-3", "P-1"]);
    expect(report.results.map((r) => r.key)).toEqual(["P-4", "P-2", "P-3", "P-1"]);
    expect(report.results.every((r) => r.ok)).toBe(true);
  });

  it("a canceled sub-task stays canceled, its own sub-tasks are left alone, and it does not block the parent", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "canceled" }], "P-2": [{ key: "P-3", status: "todo" }] });
    await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-1"]);
  });

  it("a sub-task already done is not touched again, but its open sub-tasks are closed", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "done" }], "P-2": [{ key: "P-3", status: "in_review" }] });
    await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-3", "P-1"]);
  });

  it("a sub-task that refuses → the parent is NOT marked, and the failure names the sub-task", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "todo" }, { key: "P-3", status: "todo" }] }, ["P-2"]);
    const report = await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-2", "P-3"]);
    expect(report.results).toEqual([
      { key: "P-2", ok: false, reason: "refused" },
      { key: "P-3", ok: true },
      { key: "P-1", ok: false, reason: "sub-tasks not done: P-2" },
    ]);
  });

  it("the refusal climbs through every ancestor", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "todo" }], "P-2": [{ key: "P-3", status: "todo" }] }, ["P-3"]);
    const report = await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-3"]);
    expect(report.results.filter((r) => !r.ok).map((r) => r.key)).toEqual(["P-3", "P-2", "P-1"]);
  });

  it("sub-tasks cannot be read → the task is not marked and the reason says so", async () => {
    const ports: CliPorts = {
      async run(args) {
        if (args[1] === "current") return json({ tasks: [{ key: "P-1" }] });
        return { kind: "ran", code: 1, stdout: "", stderr: "boom" };
      },
    };
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [{ key: "P-1", ok: false, reason: "sub-tasks unreadable: boom" }],
    });
  });

  it("a task linked twice — on its own and as a sub-task — is closed once and reported once", async () => {
    const bb = fakeBb(["P-1", "P-2"], { "P-1": [{ key: "P-2", status: "todo" }] });
    const report = await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(bb.updates()).toEqual(["P-2", "P-1"]);
    expect(report.results.map((r) => r.key)).toEqual(["P-2", "P-1"]);
  });

  it("every call names the thread whose tasks are being moved", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "todo" }] });
    await markLinkedTasksStatus(bb.ports, "thr_abc", "done");
    expect(new Set(bb.envs.map((e) => JSON.stringify(e)))).toEqual(new Set([JSON.stringify({ BB_THREAD_ID: "thr_abc" })]));
  });

  it("in_review still moves only the linked task and never reads sub-tasks", async () => {
    const bb = fakeBb(["P-1"], { "P-1": [{ key: "P-2", status: "todo" }] });
    await markLinkedTasksStatus(bb.ports, "thr_abc", "in_review");
    expect(bb.calls.map((c) => c[1])).toEqual(["current", "update"]);
  });

  it("the CLI disappears while a task is moved → that task fails with the spawn reason", async () => {
    const ports: CliPorts = {
      async run(args) {
        if (args[1] === "current") return json({ tasks: [{ key: "P-1" }] });
        if (args[1] === "show") return json({ subtasks: [] });
        return { kind: "unavailable", reason: "spawn bb ENOENT" };
      },
    };
    expect(await markLinkedTasksStatus(ports, "thr_abc", "done")).toEqual({
      unavailable: null,
      results: [{ key: "P-1", ok: false, reason: "spawn bb ENOENT" }],
    });
  });
});
