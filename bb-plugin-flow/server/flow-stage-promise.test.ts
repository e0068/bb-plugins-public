// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { automationInstruction } from "../core/automation-run";
import { CODE_FLOW } from "../core/stages-fixtures";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

describe("инструкции агенту не обещают запуск автоматизации", () => {
  it("строка этапа-автоматизации отсылает к ответу flow_stage, а не обещает старт", () => {
    const line = automationInstruction(CODE_FLOW[11]!, 11);
    expect(line).not.toMatch(/as soon as/);
    expect(line).toMatch(/flow_stage answer says whether it started/);
    expect(line).toMatch(/tell the owner only what that answer says/);
  });

  it("правила flow_stage велят передавать владельцу то, что ответил инструмент", () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerProgress(bb, createProgress(bb.storage.kv), { now: () => "2026-09-26T10:00:00.000Z", stages: () => ({ stages: CODE_FLOW, minButtonWidth: 170 }), windowCost: async () => undefined });
    const instructions = harness.registrations.agentTools.find((t) => t.name === FLOW_STAGE_TOOL)?.instructions ?? "";
    expect(instructions).toMatch(/answer says whether Flow started it/);
    expect(instructions).toMatch(/never tell the owner an automation runs unless the answer says it started/i);
  });
});
