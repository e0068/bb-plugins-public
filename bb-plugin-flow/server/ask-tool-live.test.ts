// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_live";
const settings: StageSettings = { stages: [...STAGES, builtinStage("demo", STAGES.map((s) => s.id))], minButtonWidth: 190 };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content: Array<{ text?: string }> }).content ?? []).map((p) => p.text ?? "").join("\n");

const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `L${++n}`, now: () => "2026-09-17T10:00:00.000Z", stages: () => settings });
  const call = (results: unknown[], extra: Record<string, unknown> = {}) =>
    harness.callAgentTool(ASK_TOOL_NAME, { title: "Демонстрация", outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results, ...extra } }, { threadId: THREAD });
  return { store, call, harness };
};

const file = { label: "spec.md", target: "memory/specs/spec.md" };

describe("живая ссылка на Демонстрации", () => {
  it("итог только с файлами не принимается, ошибка называет, что добавить", async () => {
    const { store, call } = await setup();
    const text = textOf(await call([file]));
    expect(text).toContain("Brief not accepted");
    expect(text).toContain("documentsOnly");
    expect(await store.getBrief("dec_L1")).toBeNull();
  });

  it("принимается итог со страницей, с командой запуска или с отметкой documentsOnly", async () => {
    const { store, call } = await setup();
    await call([file, { label: "страница", target: "http://localhost:5173/" }]);
    await call([{ label: "Приложение", command: "open -a Calculator" }]);
    await call([file], { documentsOnly: true });
    expect((await store.getBrief("dec_L1"))?.outcome?.results).toHaveLength(2);
    expect((await store.getBrief("dec_L2"))?.outcome?.results[0]).toEqual({ label: "Приложение", command: "open -a Calculator" });
    expect((await store.getBrief("dec_L3"))?.outcome?.documentsOnly).toBe(true);
  });

  it("инструкции инструмента называют команду запуска и documentsOnly", async () => {
    const { harness } = await setup();
    const tool = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME);
    expect(tool?.instructions).toContain("command");
    expect(tool?.instructions).toContain("documentsOnly");
    expect((tool?.instructions ?? "").length).toBeLessThanOrEqual(4096);
  });
});
