import { describe, expect, it } from "vitest";
import { backfillTaskSpend, writeTaskFact, writeTaskPlan, type FiguresKv } from "./task-figures";
import type { CliPorts, CliRun } from "./bb-cli-run";

const ok: CliRun = { kind: "ran", code: 0, stdout: "{}", stderr: "" };

function fakeCli(tasks: readonly { key: string; id?: string }[], update: (args: readonly string[]) => CliRun = () => ok) {
  const calls: string[][] = [];
  const envs: (Readonly<Record<string, string>> | undefined)[] = [];
  const ports: CliPorts = {
    async run(args, env) {
      calls.push([...args]);
      envs.push(env);
      return args[1] === "current" ? { kind: "ran", code: 0, stdout: JSON.stringify({ tasks }), stderr: "" } : update(args);
    },
  };
  return { ports, calls, envs };
}

function memoryKv(): FiguresKv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    set: async (key, value) => void data.set(key, value),
  };
}

const updates = (calls: string[][]) => calls.filter((c) => c[1] === "update");

describe("writeTaskPlan", () => {
  it("writes the plan into every task of the thread, with the thread named for the CLI", async () => {
    const { ports, calls, envs } = fakeCli([{ key: "BBPL-1" }, { key: "BBPL-2" }]);
    const report = await writeTaskPlan(ports, "thr_a", { minutes: 40, target: 10, max: 20 });
    expect(report).toEqual({ unavailable: null, results: [{ key: "BBPL-1", ok: true }, { key: "BBPL-2", ok: true }] });
    expect(updates(calls)).toEqual([
      ["tasks", "update", "BBPL-1", "--minutes", "40", "--budget", "10", "--limit", "20", "--json"],
      ["tasks", "update", "BBPL-2", "--minutes", "40", "--budget", "10", "--limit", "20", "--json"],
    ]);
    expect(envs.every((env) => env?.BB_THREAD_ID === "thr_a")).toBe(true);
  });

  it("a thread without tasks writes nothing", async () => {
    const { ports, calls } = fakeCli([]);
    expect(await writeTaskPlan(ports, "thr_a", { minutes: 40, target: 10, max: 20 })).toEqual({ unavailable: null, results: [] });
    expect(updates(calls)).toEqual([]);
  });

  it("a refused update is kept with its reason", async () => {
    const { ports } = fakeCli([{ key: "BBPL-1" }], () => ({ kind: "ran", code: 1, stdout: "", stderr: "no such task" }));
    expect(await writeTaskPlan(ports, "thr_a", { minutes: null, target: 1, max: 2 })).toEqual({
      unavailable: null,
      results: [{ key: "BBPL-1", ok: false, reason: "no such task" }],
    });
  });

  it("the CLI that cannot run is reported as unavailable", async () => {
    const ports: CliPorts = { run: async () => ({ kind: "unavailable", reason: "spawn bb ENOENT" }) };
    expect(await writeTaskPlan(ports, "thr_a", { minutes: 1, target: 1, max: 1 })).toEqual({ unavailable: "spawn bb ENOENT", results: [] });
  });
});

describe("writeTaskFact", () => {
  const task = { key: "BBPL-7", id: "proj:flow-plan-fact" };

  it("writes the thread's spend into the task", async () => {
    const { ports, calls } = fakeCli([task]);
    await writeTaskFact(ports, memoryKv(), "thr_a", { run: "run_1", minutes: 30, cost: 6.4 });
    expect(updates(calls)).toEqual([["tasks", "update", "BBPL-7", "--minutes-actual", "30", "--cost", "6.4", "--json"]]);
  });

  it("a repeated step of the same run does not count its spend twice", async () => {
    const kv = memoryKv();
    const { ports, calls } = fakeCli([task]);
    await writeTaskFact(ports, kv, "thr_a", { run: "run_1", minutes: 30, cost: 6.4 });
    await writeTaskFact(ports, kv, "thr_a", { run: "run_1", minutes: 32, cost: 6.9 });
    expect(updates(calls).at(-1)).toEqual(["tasks", "update", "BBPL-7", "--minutes-actual", "32", "--cost", "6.9", "--json"]);
  });

  it("a later run on the same task adds its spend — of the same thread too — even after the task got a new key", async () => {
    const kv = memoryKv();
    await writeTaskFact(fakeCli([{ key: "flow-plan-fact", id: "proj:flow-plan-fact" }]).ports, kv, "thr_a", { run: "run_1", minutes: 30, cost: 6.4 });
    const { ports, calls } = fakeCli([task]);
    await writeTaskFact(ports, kv, "thr_a", { run: "run_2", minutes: 10, cost: 1.1 });
    expect(updates(calls)).toEqual([["tasks", "update", "BBPL-7", "--minutes-actual", "40", "--cost", "7.5", "--json"]]);
  });

  it("a spend that did not reach the task is not remembered either", async () => {
    const kv = memoryKv();
    await writeTaskFact(fakeCli([task], () => ({ kind: "ran", code: 1, stdout: "", stderr: "boom" })).ports, kv, "thr_a", { run: "run_1", minutes: 30, cost: 6.4 });
    expect(kv.data.size).toBe(0);
  });
});

describe("writeTaskFact over several tasks", () => {
  it("each task of the thread gets an even share, so together they show what the run spent", async () => {
    const { ports, calls } = fakeCli([{ key: "BBPL-1" }, { key: "BBPL-2" }]);
    await writeTaskFact(ports, memoryKv(), "thr_a", { run: "run_1", minutes: 45, cost: 9.99 });
    expect(updates(calls)).toEqual([
      ["tasks", "update", "BBPL-1", "--minutes-actual", "22", "--cost", "4.99", "--json"],
      ["tasks", "update", "BBPL-2", "--minutes-actual", "22", "--cost", "4.99", "--json"],
    ]);
  });
});

describe("backfillTaskSpend", () => {
  type Task = { key: string; id?: string; actualMinutes?: number | null; cost?: number | null };
  const boardOf = (byThread: Record<string, readonly Task[]>, update: (args: readonly string[]) => CliRun = () => ok) => {
    const calls: { args: string[]; thread: string | undefined }[] = [];
    const ports: CliPorts = {
      async run(args, env) {
        calls.push({ args: [...args], thread: env?.BB_THREAD_ID });
        return args[1] === "current" ? { kind: "ran", code: 0, stdout: JSON.stringify({ tasks: byThread[args[3]!] ?? [] }), stderr: "" } : update(args);
      },
    };
    return { ports, written: () => calls.filter((c) => c.args[1] === "update") };
  };
  const run = (thread: string, run: string, minutes: number, cost: number) => ({ thread, spent: { run, minutes, cost } });

  it("writes every past run into the tasks of its thread, through the calling thread's tree", async () => {
    const { ports, written } = boardOf({ thr_a: [{ key: "BBPL-1" }], thr_b: [{ key: "BBPL-1" }, { key: "BBPL-2" }] });
    const lines = await backfillTaskSpend(ports, memoryKv(), [run("thr_a", "a@1", 30, 6), run("thr_b", "b@1", 20, 4)], "thr_me", false);
    expect(written().map((c) => [c.thread, ...c.args.slice(2, 7)])).toEqual([
      ["thr_me", "BBPL-1", "--minutes-actual", "30", "--cost", "6"],
      ["thr_me", "BBPL-1", "--minutes-actual", "40", "--cost", "8"],
      ["thr_me", "BBPL-2", "--minutes-actual", "10", "--cost", "2"],
    ]);
    expect(lines.filter((l) => "written" in l)).toHaveLength(3);
  });

  it("a second backfill writes nothing: every run is already counted", async () => {
    const kv = memoryKv();
    const { ports, written } = boardOf({ thr_a: [{ key: "BBPL-1" }] });
    await backfillTaskSpend(ports, kv, [run("thr_a", "a@1", 30, 6)], "thr_me", false);
    const again = await backfillTaskSpend(ports, kv, [run("thr_a", "a@1", 30, 6)], "thr_me", false);
    expect(written()).toHaveLength(1);
    expect(again).toEqual([{ run: "a@1", key: "BBPL-1", skipped: "counted" }]);
  });

  it("a task with figures an agent typed keeps them", async () => {
    const { ports, written } = boardOf({ thr_a: [{ key: "BBPL-1", actualMinutes: 90, cost: null }] });
    expect(await backfillTaskSpend(ports, memoryKv(), [run("thr_a", "a@1", 30, 6)], "thr_me", false)).toEqual([{ run: "a@1", key: "BBPL-1", skipped: "recorded" }]);
    expect(written()).toEqual([]);
  });

  it("a dry run reports the same totals and writes nothing", async () => {
    const kv = memoryKv();
    const { ports, written } = boardOf({ thr_a: [{ key: "BBPL-1" }], thr_b: [{ key: "BBPL-1" }] });
    const lines = await backfillTaskSpend(ports, kv, [run("thr_a", "a@1", 30, 6), run("thr_b", "b@1", 5, 1)], "thr_me", true);
    expect(lines.at(-1)).toEqual({ run: "b@1", key: "BBPL-1", written: { minutes: 35, cost: 7 } });
    expect(written()).toEqual([]);
    expect(kv.data.size).toBe(0);
  });

  it("a refused write is reported and not remembered", async () => {
    const kv = memoryKv();
    const { ports } = boardOf({ thr_a: [{ key: "BBPL-1" }] }, () => ({ kind: "ran", code: 1, stdout: "", stderr: "boom" }));
    expect(await backfillTaskSpend(ports, kv, [run("thr_a", "a@1", 30, 6)], "thr_me", false)).toEqual([{ run: "a@1", key: "BBPL-1", failed: "boom" }]);
    expect(kv.data.size).toBe(0);
  });
});

describe("writeTaskFact under the run's own id", () => {
  it("replaces the entry the same run got under its former name instead of adding to it", async () => {
    const kv = memoryKv();
    const task = { key: "BBPL-7", id: "proj:flow-plan-fact" };
    await writeTaskFact(fakeCli([task]).ports, kv, "thr_a", { run: "thr_a@1", minutes: 30, cost: 6 });
    const { ports, calls } = fakeCli([task]);
    await writeTaskFact(ports, kv, "thr_b", { run: "run_1", aliases: ["thr_a@1"], minutes: 40, cost: 8 });
    expect(updates(calls)).toEqual([["tasks", "update", "BBPL-7", "--minutes-actual", "40", "--cost", "8", "--json"]]);
  });
});
