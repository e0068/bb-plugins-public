import { describe, expect, it } from "vitest";

import { STEP_IDS, STEP_LABELS } from "./catalog";
import { createSteps, type RunFigures, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";
import type { PluginsPort } from "./wiring/plugin-reinstall";

const ok: CliRun = { kind: "ran", code: 0, stdout: "{}", stderr: "" };

const board = (tasks: readonly { key: string; id?: string }[], update: CliRun = ok) => {
  const updates: string[][] = [];
  const cli: CliPorts = {
    async run(args) {
      if (args[1] === "current") return { kind: "ran", code: 0, stdout: JSON.stringify({ tasks }), stderr: "" };
      updates.push([...args]);
      return update;
    },
  };
  return { cli, updates };
};

const steps = (cli: CliPorts, runFigures?: (threadId: string) => Promise<RunFigures | null>) => {
  const data = new Map<string, unknown>();
  const ports: StepPorts = {
    sdk: {} as StepPorts["sdk"],
    kv: { get: async (key: string) => data.get(key), set: async (key: string, value: unknown) => void data.set(key, value), delete: async () => {}, list: async () => [] } as unknown as StepPorts["kv"],
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins: {} as PluginsPort,
    ownPluginId: "flow",
    cli,
    sleep: async () => {},
    ...(runFigures === undefined ? {} : { runFigures }),
  };
  return createSteps(ports);
};

const figuresOf = (run: string, spent: { minutes: number; cost: number } | null): RunFigures => ({
  planned: { minutes: 51, target: 12.52, max: 25.03 },
  spent: async () => (spent === null ? null : { run, ...spent }),
});
const figures = figuresOf("run_1", { minutes: 47, cost: 9.81 });

describe("шаги «План → задача» и «Факт → задача»", () => {
  it("есть в каталоге и подписаны на обоих языках", () => {
    expect(STEP_IDS).toEqual(expect.arrayContaining(["bb.tasks-plan", "bb.tasks-fact"]));
    expect(STEP_LABELS["bb.tasks-plan"]).toEqual({ en: "Plan → task", ru: "План → задача" });
    expect(STEP_LABELS["bb.tasks-fact"]).toEqual({ en: "Spend → task", ru: "Факт → задача" });
  });

  it("план прогона ложится в задачу треда: минуты, бюджет и потолок", async () => {
    const { cli, updates } = board([{ key: "BBPL-7" }]);
    expect(await steps(cli, async () => figures)["bb.tasks-plan"]("t1")).toEqual({ ok: true, detail: "BBPL-7" });
    expect(updates).toEqual([["tasks", "update", "BBPL-7", "--minutes", "51", "--budget", "12.52", "--limit", "25.03", "--json"]]);
  });

  it("факт прогона ложится в задачу треда: минуты и стоимость", async () => {
    const { cli, updates } = board([{ key: "BBPL-7" }]);
    expect(await steps(cli, async () => figures)["bb.tasks-fact"]("t1")).toEqual({ ok: true, detail: "BBPL-7" });
    expect(updates).toEqual([["tasks", "update", "BBPL-7", "--minutes-actual", "47", "--cost", "9.81", "--json"]]);
  });

  it("тред без задачи проходит оба шага зелёным и ничего не пишет", async () => {
    const { cli, updates } = board([]);
    const all = steps(cli, async () => figures);
    expect(await all["bb.tasks-plan"]("t1")).toEqual({ ok: true, detail: "no linked tasks" });
    expect(await all["bb.tasks-fact"]("t1")).toEqual({ ok: true, detail: "no linked tasks" });
    expect(updates).toEqual([]);
  });

  it("прогон без бюджета и без итога проходит зелёным с пометкой и ничего не пишет", async () => {
    const { cli, updates } = board([{ key: "BBPL-7" }]);
    const empty = steps(cli, async () => ({ planned: null, spent: async () => null }));
    expect(await empty["bb.tasks-plan"]("t1")).toEqual({ ok: true, detail: "no plan in the run" });
    expect(await empty["bb.tasks-fact"]("t1")).toEqual({ ok: true, detail: "no spend in the run" });
    const unwired = steps(cli);
    expect(await unwired["bb.tasks-plan"]("t1")).toEqual({ ok: true, detail: "no plan in the run" });
    expect(await unwired["bb.tasks-fact"]("t1")).toEqual({ ok: true, detail: "no spend in the run" });
    expect(updates).toEqual([]);
  });

  it("следующий прогон того же треда прибавляет свой факт, повтор шага в прогоне — заменяет", async () => {
    const { cli, updates } = board([{ key: "BBPL-7", id: "proj:flow-plan-fact" }]);
    let current = figuresOf("run_1", { minutes: 30, cost: 6 });
    const fact = steps(cli, async () => current)["bb.tasks-fact"];
    await fact("t1");
    await fact("t1");
    current = figuresOf("run_2", { minutes: 10, cost: 1.5 });
    await fact("t1");
    expect(updates.map((u) => u.slice(3, 7))).toEqual([
      ["--minutes-actual", "30", "--cost", "6"],
      ["--minutes-actual", "30", "--cost", "6"],
      ["--minutes-actual", "40", "--cost", "7.5"],
    ]);
  });

  it("задача, не принявшая числа, краснит шаг с причиной", async () => {
    const { cli } = board([{ key: "BBPL-7" }], { kind: "ran", code: 1, stdout: "", stderr: "no such task" });
    expect(await steps(cli, async () => figures)["bb.tasks-fact"]("t1")).toEqual({ ok: false, error: "Spend not written: BBPL-7 (no such task)" });
  });
});
