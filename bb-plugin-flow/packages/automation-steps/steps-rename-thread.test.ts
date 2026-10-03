import { describe, expect, it } from "vitest";

import { STEP_LABELS } from "./catalog";
import { createSteps, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";
import type { PluginsPort } from "./wiring/plugin-reinstall";

const linked = (tasks: readonly unknown[]): CliRun => ({ kind: "ran", code: 0, stdout: JSON.stringify({ tasks }), stderr: "" });

const cliReplying = (reply: CliRun): CliPorts => ({ run: async () => reply });

/** Тред, чьи переименования записываются: шаг трогает у SDK только threads.update. */
const harness = (cli: CliPorts, update: (args: { threadId: string; title: string }) => Promise<unknown> = async () => ({})) => {
  const renames: { threadId: string; title: string }[] = [];
  const ports: StepPorts = {
    sdk: {
      threads: {
        update: async (args: { threadId: string; title: string }) => {
          renames.push(args);
          return update(args);
        },
      },
    } as unknown as StepPorts["sdk"],
    kv: { get: async () => undefined, set: async () => {}, delete: async () => {}, list: async () => [] } as unknown as StepPorts["kv"],
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins: {} as PluginsPort,
    ownPluginId: "flow",
    cli,
    sleep: async () => {},
  };
  return { rename: createSteps(ports)["bb.rename-thread"], renames };
};

describe("шаг «Переименовать тред»", () => {
  it("подписан «Переименовать тред» и «Rename the thread»", () => {
    expect(STEP_LABELS["bb.rename-thread"]).toEqual({ en: "Rename the thread", ru: "Переименовать тред" });
  });

  it("называет тред названием привязанной задачи, без ключа", async () => {
    const { rename, renames } = harness(cliReplying(linked([{ key: "BBPL-7", title: "Flow — шаг Переименовать тред" }])));
    expect(await rename("t1")).toEqual({ ok: true, detail: "Flow — шаг Переименовать тред" });
    expect(renames).toEqual([{ threadId: "t1", title: "Flow — шаг Переименовать тред" }]);
  });

  it("многострочное название задачи становится одной строкой", async () => {
    const { rename, renames } = harness(cliReplying(linked([{ key: "BBPL-7", title: "  Flow —\n шаг  " }])));
    await rename("t1");
    expect(renames).toEqual([{ threadId: "t1", title: "Flow — шаг" }]);
  });

  it("без привязанной задачи падает и не трогает имя треда", async () => {
    const { rename, renames } = harness(cliReplying(linked([])));
    expect(await rename("t1")).toEqual({ ok: false, error: expect.stringContaining("No task is linked to the thread") });
    expect(renames).toEqual([]);
  });

  it("доска, отказавшая в списке задач, называет свой отказ, а не «задачи нет»", async () => {
    const { rename, renames } = harness(cliReplying({ kind: "ran", code: 1, stdout: "", stderr: "unknown command: tasks" }));
    const outcome = await rename("t1");
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("unknown command: tasks") });
    expect(outcome).not.toMatchObject({ error: expect.stringContaining("No task is linked") });
    expect(renames).toEqual([]);
  });

  it("недоступный bb называет причину, а не «задачи нет»", async () => {
    const { rename, renames } = harness(cliReplying({ kind: "unavailable", reason: "bb not found" }));
    const outcome = await rename("t1");
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("bb not found") });
    expect(outcome).not.toMatchObject({ error: expect.stringContaining("No task is linked") });
    expect(renames).toEqual([]);
  });

  it("задача без названия не стирает имя треда", async () => {
    const { rename, renames } = harness(cliReplying(linked([{ key: "BBPL-7", title: "  " }])));
    expect(await rename("t1")).toEqual({ ok: false, error: expect.stringContaining("BBPL-7") });
    expect(renames).toEqual([]);
  });

  it("отказ bb переименовать становится ok false с его текстом", async () => {
    const { rename } = harness(cliReplying(linked([{ key: "BBPL-7", title: "Имя" }])), async () => Promise.reject(new Error("thread is busy")));
    expect(await rename("t1")).toEqual({ ok: false, error: "thread is busy" });
  });
});
