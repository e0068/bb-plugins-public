// @vitest-environment node
// Команда `bb flow-spend backfill`: разбор аргументов, запись через дерево вызвавшего треда и отчёт.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { CliPorts } from "@bb-plugins/automation-steps/wiring/bb-cli-run";
import { backfillReport, registerSpendBackfill, SPEND_CLI } from "./spend-backfill";

const board = (): { cli: CliPorts; writes: string[][] } => {
  const writes: string[][] = [];
  return {
    writes,
    cli: {
      async run(args, env) {
        if (args[1] === "current") return { kind: "ran", code: 0, stdout: JSON.stringify({ tasks: [{ key: "BBPL-1" }] }), stderr: "" };
        writes.push([env?.BB_THREAD_ID ?? "", ...args]);
        return { kind: "ran", code: 0, stdout: "{}", stderr: "" };
      },
    },
  };
};

const setup = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const b = board();
  registerSpendBackfill(bb, async () => [{ thread: "thr_old", spent: { run: "thr_old@1", minutes: 42, cost: 7.5 } }], () => b.cli);
  return { harness, ...b };
};

describe(SPEND_CLI, () => {
  it("пишет факт прошлых прогонов в задачи через дерево вызвавшего треда", async () => {
    const { harness, writes } = setup();
    const result = await harness.runCli(["backfill"], { threadId: "thr_me" });
    expect(result.exitCode).toBe(0);
    expect(writes).toEqual([["thr_me", "tasks", "update", "BBPL-1", "--minutes-actual", "42", "--cost", "7.5", "--json"]]);
    expect(result.stdout).toContain("BBPL-1\t42 min\t$7.50");
  });

  it("--dry-run показывает то же и ничего не пишет", async () => {
    const { harness, writes } = setup();
    const result = await harness.runCli(["backfill", "--dry-run"], { threadId: "thr_me" });
    expect(writes).toEqual([]);
    expect(result.stdout).toContain("Would write: 1 tasks from 1 runs");
  });

  it("вне треда и с чужими аргументами отказывает", async () => {
    const { harness } = setup();
    expect((await harness.runCli(["backfill"], {})).exitCode).toBe(1);
    expect((await harness.runCli(["oops"], { threadId: "thr_me" })).exitCode).toBe(1);
  });

  it("отчёт считает задачу один раз, с итогом после последнего прогона", () => {
    const report = backfillReport(
      [
        { run: "a", key: "BBPL-1", written: { minutes: 10, cost: 1 } },
        { run: "b", key: "BBPL-1", written: { minutes: 15, cost: 1.5 } },
        { run: "b", key: "BBPL-2", skipped: "recorded" },
      ],
      false,
    );
    expect(report.split("\n")).toEqual(["BBPL-1\t15 min\t$1.50", "Written: 1 tasks from 2 runs; already counted 0, kept agent figures 1, failed 0."]);
  });
});
