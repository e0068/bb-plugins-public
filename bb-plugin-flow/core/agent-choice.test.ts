// @vitest-environment node
// Выбор агента в ряду виджета — три случая владельца: тред в Bug, агент предлагает BB Plugin.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { Execution, WidgetAgent } from "../shared/contract";
import { answeredExecution, chosenExecution, chosenFlowId, flowLook, itemMarks, modelLook, proposedExecution, providerChanged, sameExecution, switchModel, switchProvider } from "./agent-choice";

const opus: Execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
const sonnet: Execution = { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" };
const catalog: WidgetAgent = {
  current: opus,
  currentFlowId: "bug",
  providers: [
    { id: "claude-code", name: "Claude Code", models: [{ model: "opus", name: "Opus", efforts: ["low", "medium", "high"], defaultEffort: "high" }, { model: "sonnet", name: "Sonnet", efforts: ["low", "medium"], defaultEffort: "medium" }] },
    { id: "codex", name: "Codex", models: [{ model: "gpt-5-codex", name: "GPT-5 Codex", efforts: ["medium", "high"], defaultEffort: "medium" }] },
  ],
  flows: [{ id: "bug", name: "Bug" }, { id: "bb", name: "BB Plugin", execution: sonnet }, { id: "research", name: "Research" }],
};

const marks = (flows: readonly string[], chosen: string, proposed: string | null) => flows.map((id) => itemMarks(id, { chosen, current: "bug", proposed }));

describe("flow в ряду виджета", () => {
  it("тред в Bug, агент предлагает BB Plugin: выбран BB Plugin с ✦, на Bug — «Сейчас»", () => {
    const chosen = chosenFlowId(catalog, undefined, "bb");
    expect(chosen).toBe("bb");
    expect(flowLook("bug", chosen, "bb")).toEqual({ wide: true, agent: true });
    expect(marks(["bug", "bb"], chosen!, "bb")).toEqual([{ on: false, now: true, agent: false }, { on: true, now: false, agent: true }]);
  });

  it("владелец вернул Bug: галочка на Bug, ✦ остаётся на BB Plugin, кнопка квадратная", () => {
    const chosen = chosenFlowId(catalog, null, "bb");
    expect(chosen).toBe("bug");
    expect(flowLook("bug", chosen, "bb")).toEqual({ wide: false, agent: false });
    expect(marks(["bug", "bb"], chosen!, "bb")).toEqual([{ on: true, now: false, agent: false }, { on: false, now: false, agent: true }]);
  });

  it("владелец выбрал Research без предложения: галочка на нём, на Bug — «Сейчас»", () => {
    const chosen = chosenFlowId(catalog, "research", undefined);
    expect(flowLook("bug", chosen, undefined)).toEqual({ wide: true, agent: false });
    expect(marks(["bug", "research"], chosen!, null)).toEqual([{ on: false, now: true, agent: false }, { on: true, now: false, agent: false }]);
  });

  it("галочка — ровно у одного пункта, «Сейчас» и галочка не вместе", () => {
    fc.assert(
      fc.property(fc.constantFrom("bug", "bb", "research"), fc.option(fc.constantFrom("bug", "bb", "research"), { nil: null }), (chosen, proposed) => {
        const all = marks(["bug", "bb", "research"], chosen, proposed);
        expect(all.filter((m) => m.on)).toHaveLength(1);
        expect(all.some((m) => m.on && m.now)).toBe(false);
      }),
    );
  });
});

describe("модель в ряду виджета", () => {
  it("выбранный flow предлагает свою модель; текущий flow и та же модель — не предлагают", () => {
    expect(proposedExecution(catalog, "bb")).toEqual(sonnet);
    expect(proposedExecution(catalog, "bug")).toBeNull();
    expect(proposedExecution(catalog, "research")).toBeNull();
    expect(proposedExecution({ ...catalog, current: sonnet }, "bb")).toBeNull();
  });

  it("предложение без касания владельца — выбранная модель с ✦; тронутая владельцем — его", () => {
    const proposed = proposedExecution(catalog, "bb");
    expect(modelLook(opus, chosenExecution(catalog, undefined, proposed), proposed)).toEqual({ wide: true, agent: true });
    expect(modelLook(opus, chosenExecution(catalog, opus, proposed), proposed)).toEqual({ wide: false, agent: false });
  });

  it("смена провайдера — модель по умолчанию нового, и только новый тред", () => {
    const codex = switchProvider(catalog, opus, "codex");
    expect(codex).toEqual({ providerId: "codex", model: "gpt-5-codex", reasoningLevel: "medium" });
    expect(providerChanged(opus, codex)).toBe(true);
    expect(switchProvider(catalog, codex, "claude-code")).toEqual(opus);
  });

  it("смена модели держит effort, если модель его знает, иначе — её по умолчанию", () => {
    expect(switchModel(catalog, opus, "sonnet")).toEqual({ ...sonnet, reasoningLevel: "medium" });
    expect(switchModel(catalog, { ...opus, reasoningLevel: "low" }, "sonnet").reasoningLevel).toBe("low");
  });

  it("в ответ уходит только отличный от текущего выбор; скорость без поля — обычная", () => {
    expect(answeredExecution(opus, opus)).toBeUndefined();
    expect(answeredExecution(opus, sonnet)).toEqual(sonnet);
    expect(sameExecution(opus, { ...opus, serviceTier: "default" })).toBe(true);
    expect(answeredExecution(opus, { ...opus, serviceTier: "fast" })).toEqual({ ...opus, serviceTier: "fast" });
  });
});
