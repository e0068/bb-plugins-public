// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

describe("инструкции инструмента о двух частях брифа", () => {
  it("называют виды вопросов второй части и шкалу риска", () => {
    for (const word of ["fork", "pick", "confirm", "XS", "XXL"]) expect(ASK_INSTRUCTIONS).toContain(word);
  });
});

describe("инструмент ask_decision и уровень риска", () => {
  it("вызов развилки без уровня риска отбивается схемой", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "T1", now: () => "2026-09-13T00:00:00.000Z" });
    const option = (id: string, risk?: string) => ({ id, action: id, description: "Что произойдёт", cost: "~1M", ...(risk === undefined ? { risks: "мелкие" } : { risk }) });
    const call = (options: unknown[]) => harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", questions: [{ id: "f", question: "Как?", kind: "fork", options }] });
    await expect(call([option("a", "S"), option("b")])).rejects.toThrow();
    await expect(call([option("a", "S"), option("b", "XL")])).resolves.toBeTruthy();
  });
});
