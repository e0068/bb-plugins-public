// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowSettings } from "../shared/contract";
import { agentFor, defaultExecutionOf, executionFor, providerModelsOf, startMessageOf } from "./flow-agent";
import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW } from "./flows";

const opus = { providerId: "claude-code", model: "opus", reasoningLevel: "high" as const };
const settings: FlowSettings = {
  version: 2,
  minButtonWidth: 160,
  flows: [
    { id: "bug", name: "Bug", stages: [], agent: { execution: opus, start: "Сначала воспроизведи" } },
    { id: "plain", name: "Plain", stages: [] },
  ],
  autoAgent: { start: "Выбери flow" },
};

describe("агент треда по flow", () => {
  it("настоящий flow — его настройки, «Автоматически» — строки «Автоматически», без flow — ничего", () => {
    expect(agentFor(settings, "bug")?.start).toBe("Сначала воспроизведи");
    expect(agentFor(settings, "plain")).toBeUndefined();
    expect(agentFor(settings, AUTO_FLOW)).toEqual({ start: "Выбери flow" });
    expect(agentFor(settings, NO_FLOW)).toBeUndefined();
    expect(agentFor(settings, AGENT_NO_FLOW)).toBeUndefined();
  });

  it("модель — только тому же провайдеру", () => {
    const agent = agentFor(settings, "bug");
    expect(executionFor(agent, "claude-code")).toEqual({ model: "opus", reasoningLevel: "high" });
    expect(executionFor(agent, "codex")).toBeNull();
    expect(executionFor(undefined, "claude-code")).toBeNull();
  });

  it("стартовое сообщение без краевых пробелов; пустое — нет сообщения", () => {
    expect(startMessageOf({ start: "  Пиши коротко " })).toBe("Пиши коротко");
    expect(startMessageOf({ start: "   " })).toBeNull();
    expect(startMessageOf(undefined)).toBeNull();
  });
});

describe("модель по умолчанию из каталога bb", () => {
  const catalog = {
    providers: [{ id: "claude-code", available: true }, { id: "codex", available: false }],
    models: [
      { model: "sonnet", isDefault: false, defaultReasoningEffort: "medium" },
      { model: "opus", isDefault: true, defaultReasoningEffort: "high" },
    ],
  };

  it("помеченная по умолчанию, с её effort", () => {
    expect(defaultExecutionOf(catalog, "claude-code")).toEqual(opus);
  });

  it("без пометки — первая; недоступный провайдер и пустой каталог — нет модели", () => {
    expect(defaultExecutionOf({ ...catalog, models: [catalog.models[0]!] }, "claude-code")?.model).toBe("sonnet");
    expect(defaultExecutionOf(catalog, "codex")).toBeNull();
    expect(defaultExecutionOf({ ...catalog, models: [] }, "claude-code")).toBeNull();
  });

  it("незнакомый effort читается как medium", () => {
    expect(defaultExecutionOf({ ...catalog, models: [{ model: "x", isDefault: true, defaultReasoningEffort: "turbo" }] }, "claude-code")?.reasoningLevel).toBe("medium");
  });
});

describe("модели провайдера для колонок виджета", () => {
  it("модель по умолчанию первой, имя — отображаемое, незнакомый effort отброшен", () => {
    const catalog = {
      providers: [{ id: "claude-code", available: true }],
      models: [
        { model: "sonnet", displayName: "Sonnet 5.5", isDefault: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "turbo" }] },
        { model: "opus", isDefault: true, defaultReasoningEffort: "high" },
      ],
    };
    expect(providerModelsOf(catalog, "claude-code")).toEqual([
      { model: "opus", name: "opus", efforts: [], defaultEffort: "high" },
      { model: "sonnet", name: "Sonnet 5.5", efforts: ["low"], defaultEffort: "medium" },
    ]);
  });
});
