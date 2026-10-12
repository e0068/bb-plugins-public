// @vitest-environment node
// Настройки агента flow и строки «Автоматически»: пустое снимает поле, повтор правки коллекцию не меняет.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { agentSettingsSchema, flowSettingsSchema, type AgentSettings, type FlowSettings } from "../shared/contract";
import { setAutoAgent, setFlowAgent, settledAgent } from "./flows";

const opus = { providerId: "claude-code", model: "opus", reasoningLevel: "high" as const };
const settings: FlowSettings = { version: 2, minButtonWidth: 160, flows: [{ id: "a", name: "A", stages: [builtinStage("questions", [])] }] };

describe("настройки агента flow", () => {
  it("модель и сообщение ложатся во flow; сообщение без краевых пробелов", () => {
    const next = setFlowAgent(settings, "a", { execution: opus, start: "  Пиши по-русски \n" });
    expect(next.flows[0]!.agent).toEqual({ execution: opus, start: "Пиши по-русски" });
  });

  it("пустое сообщение и снятая модель снимают поле целиком", () => {
    const set = setFlowAgent(settings, "a", { execution: opus });
    expect(setFlowAgent(set, "a", { start: "   " }).flows[0]).not.toHaveProperty("agent");
    expect(setFlowAgent(set, "a", undefined).flows[0]).not.toHaveProperty("agent");
  });

  it("«Автоматически» — своё поле коллекции", () => {
    const next = setAutoAgent(settings, { start: "Сперва выбери flow" });
    expect(next.autoAgent).toEqual({ start: "Сперва выбери flow" });
    expect(setAutoAgent(next, { start: "" })).not.toHaveProperty("autoAgent");
  });

  it("повтор той же правки коллекцию не меняет", () => {
    const agent = fc.record({ execution: fc.option(fc.constant(opus), { nil: undefined }), start: fc.option(fc.string(), { nil: undefined }) }, { requiredKeys: [] });
    fc.assert(
      fc.property(agent, (a: AgentSettings) => {
        const once = setFlowAgent(settings, "a", a);
        expect(setFlowAgent(once, "a", a)).toEqual(once);
        expect(settledAgent(settledAgent(a))).toEqual(settledAgent(a));
      }),
    );
  });
});

describe("схема настроек агента", () => {
  it("пустые настройки принимаются, сообщение длиннее 4000 — нет", () => {
    expect(agentSettingsSchema.safeParse({}).success).toBe(true);
    expect(agentSettingsSchema.safeParse({ start: "x".repeat(4001) }).success).toBe(false);
    expect(agentSettingsSchema.safeParse({ execution: { ...opus, reasoningLevel: "turbo" } }).success).toBe(false);
  });

  it("старая коллекция без полей агента читается", () => {
    expect(flowSettingsSchema.safeParse(settings).success).toBe(true);
  });
});
