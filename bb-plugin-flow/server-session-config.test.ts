// @vitest-environment node
// Flow выбирает сессии агента свои инструменты и навыки сам: инструмент, который плагин зарегистрировал, но в выбор
// не попал, агент бы потерял.
import { readdirSync } from "node:fs";
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CHOOSE_FLOW_SKILL } from "./lib/stage-constants";
import plugin from "./server";

// Навык выбора flow едет в skills/, но его читает модель выбора до хода, а не агент треда.
const shipped = readdirSync(new URL("./skills/", import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== CHOOSE_FLOW_SKILL)
  .map((entry) => entry.name);

describe("выбор инструментов сессии плагином Flow", () => {
  it("каждый зарегистрированный инструмент Flow и каждый его навык доходят до сессии", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow", agentSkillIds: shipped });
    await plugin(bb);
    const resolved = await harness.resolveAgentConfiguration(makePluginAgentConfigurationContext());
    expect(resolved.tools.map((tool) => tool.name).sort()).toEqual(harness.registrations.agentTools.map((tool) => tool.name).sort());
    expect([...resolved.skills].sort()).toEqual([...shipped].sort());
  });
});
