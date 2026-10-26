// @vitest-environment node
// Терминал владельца берёт строку не длиннее 1024 символов: длиннее он обрезает, и в терминал уходит кусок команды.
// Поэтому длинная команда отбивается ещё у агента — с пределом и подсказкой положить скрипт в хранилище треда.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { COMMAND_ID_PREFIX } from "../core/directive";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { COMMAND_TOOL_NAME, registerCommands } from "./command";
import { createStore } from "./store";

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content: Array<{ text?: string }> }).content ?? []).map((p) => p.text ?? "").join("\n");

const ofLength = (n: number): string => `echo ${"x".repeat(n - 5)}`;

describe("share_command и длина команды", () => {
  const setup = () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerCommands(bb, { newId: () => "C1", now: () => "2026-10-26T12:00:00.000Z" });
    return { harness };
  };

  it("команда в 1025 символов отбивается: ответ называет предел и путь через скрипт в хранилище треда, команда не сохраняется", async () => {
    const { harness } = setup();
    const result = await harness.callAgentTool(COMMAND_TOOL_NAME, { command: ofLength(1025) }, { threadId: "thr_a" });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("1025");
    expect(text).toContain("1024");
    expect(text).toContain("thread storage");
    expect(text).toContain("script");
    expect(text).not.toContain("::command");
    expect(await harness.callRpc("getCommand", { id: `${COMMAND_ID_PREFIX}C1` })).toEqual({ kind: "not_found" });
  });

  it("команда ровно в 1024 символа принимается", async () => {
    const { harness } = setup();
    const command = ofLength(1024);
    expect(command).toHaveLength(1024);
    const result = await harness.callAgentTool(COMMAND_TOOL_NAME, { command }, { threadId: "thr_a" });
    expect(textOf(result)).toContain("::command");
  });
});

describe("команда результата Демонстрации и длина", () => {
  const THREAD = "thr_demo";
  const settings: StageSettings = { stages: [builtinStage("demo", [])], minButtonWidth: 190 };
  const host = async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    await store.markLaunched(THREAD);
    registerAskTool(bb, store, { newId: () => "R1", now: () => "2026-10-26T12:00:00.000Z", stages: () => settings, flowIds: () => [] });
    const ask = async (command: string) =>
      JSON.stringify(
        await harness.callAgentTool(ASK_TOOL_NAME, { title: "Демо", questions: [], outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "Запуск", command }] } }, { threadId: THREAD }),
      );
    return { ask, store };
  };

  it("Демонстрация с командой длиннее 1024 символов отбивается с той же подсказкой", async () => {
    const { ask, store } = await host();
    const result = await ask(ofLength(1025));
    expect(result).toContain("Brief not accepted");
    expect(result).toContain("1024");
    expect(result).toContain("thread storage");
    expect(await store.getBrief("dec_R1")).toBeNull();
  });

  it("Демонстрация с командой ровно в 1024 символа принимается", async () => {
    const { ask, store } = await host();
    expect(await ask(ofLength(1024))).not.toContain("Brief not accepted");
    expect(await store.getBrief("dec_R1")).not.toBeNull();
  });
});
