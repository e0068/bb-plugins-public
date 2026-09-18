// @vitest-environment node
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

const loaded = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
  await plugin(bb);
  return harness;
};

describe("плагин Decisions", () => {
  it("плагин регистрирует оба метода RPC", async () => {
    const harness = await loaded();
    expect(harness.registrations.rpcMethods).toEqual(expect.arrayContaining(["getBrief", "answerBrief"]));
  });

  it("плагин регистрирует инструмент ask_decision", async () => {
    const harness = await loaded();
    expect(harness.registrations.agentTools.map((t) => t.name)).toContain("ask_decision");
  });

  it("инструмент попадает в набор треда без вызова configure", async () => {
    const harness = await loaded();
    const { tools } = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext());
    expect(tools.map((t) => t.name)).toContain("ask_decision");
  });

  it("два брифа с первой частью подряд получают разные идентификаторы с префиксом dec_", async () => {
    const harness = await loaded();
    const params = {
      title: "Бриф",
      setup: { criteria: ["Тесты зелёные"] },
    };
    const ids = await Promise.all([1, 2].map(async () => {
      const result = await harness.callAgentTool("ask_decision", params);
      return /id="(dec_[^"]+)"/.exec(typeof result === "string" ? result : "")?.[1];
    }));
    expect(ids[0]).toMatch(/^dec_/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
