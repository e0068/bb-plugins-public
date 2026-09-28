import { describe, expect, it } from "vitest";
import { readLinkedTask } from "./linked-task";
import type { CliPorts, CliRun } from "./bb-cli-run";

function fakePorts(reply: CliRun): { ports: CliPorts; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    ports: {
      async run(args) {
        calls.push([...args]);
        return reply;
      },
    },
  };
}

function currentReply(tasks: readonly unknown[]): CliRun {
  return { kind: "ran", code: 0, stdout: JSON.stringify({ tasks }), stderr: "" };
}

describe("readLinkedTask", () => {
  it("reads the thread's task through `bb tasks current`", async () => {
    const { ports, calls } = fakePorts(
      currentReply([{ key: "BP-189", title: "Pull Request — названия" }]),
    );
    expect(await readLinkedTask(ports, "thr_abc")).toEqual({
      key: "BP-189",
      title: "Pull Request — названия",
    });
    expect(calls).toEqual([["tasks", "current", "--thread", "thr_abc", "--json"]]);
  });

  it("several linked tasks → the first one names the work", async () => {
    const { ports } = fakePorts(
      currentReply([
        { key: "BP-189", title: "Первая" },
        { key: "BP-190", title: "Вторая" },
      ]),
    );
    expect(await readLinkedTask(ports, "thr_abc")).toEqual({ key: "BP-189", title: "Первая" });
  });

  it("no linked task → null", async () => {
    const { ports } = fakePorts(currentReply([]));
    expect(await readLinkedTask(ports, "thr_abc")).toBeNull();
  });

  // Tasks+ absent, the thread never linked, output shape changed — all read
  // as "no task named this work", never as a failure: the PR must still open.
  it("the CLI refusing → null, no throw", async () => {
    const { ports } = fakePorts({
      kind: "ran",
      code: 1,
      stdout: "",
      stderr: "unknown command: tasks",
    });
    expect(await readLinkedTask(ports, "thr_abc")).toBeNull();
  });

  // Unlike markLinkedTasksStatus, which reports this shape as `unavailable`:
  // there a promised transition was lost, here only the name gets poorer.
  it("`bb` not runnable at all → null, no throw", async () => {
    const { ports } = fakePorts({ kind: "unavailable", reason: "bb: not found on PATH" });
    expect(await readLinkedTask(ports, "thr_abc")).toBeNull();
  });

  it("unparsable output → null, no throw", async () => {
    const { ports } = fakePorts({ kind: "ran", code: 0, stdout: "not json", stderr: "" });
    expect(await readLinkedTask(ports, "thr_abc")).toBeNull();
  });
});
