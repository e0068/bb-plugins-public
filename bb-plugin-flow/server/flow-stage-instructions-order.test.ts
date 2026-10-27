// @vitest-environment node
// Правила для агента говорят: ни начать, ни закрыть этап нельзя, пока не закрыты этапы перед ним; пропустить этап может только владелец.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const instructions = (): string => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv, { onChange: () => undefined });
  registerProgress(bb, progress, { now: () => "2026-10-13T10:00:00.000Z", stages: () => ({ stages: [], minButtonWidth: 170 }), windowCost: async () => undefined, thread: async () => ({ active: false, providerId: "claude-code", environmentId: null }) });
  return harness.registrations.agentTools.find((tool) => tool.name === FLOW_STAGE_TOOL)?.instructions ?? "";
};

describe("правила flow_stage для агента", () => {
  it("называют и начало, и закрытие этапа", () => {
    expect(instructions()).toMatch(/starts or is marked done only after every skill stage of the run before it is marked done/);
  });

  it("оставляют пропуск этапа владельцу", () => {
    expect(instructions()).toMatch(/only the owner can take a stage out of the run/);
  });

  it("укладываются в предел длины правил инструмента", () => {
    expect(instructions().length).toBeLessThanOrEqual(4096);
  });
});
