// @vitest-environment node
// Шапка Flow платится в каждом вызове агента: описание, инструкции и схема ask_decision вместе с инструкциями хода.
// Мерило считает так же, как разведка: инструмент регистрируется на фальшивом bb, схема переводится в JSON Schema так, как это делает хост.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { DEFAULT_STAGES } from "../core/flows";
import { ASK_TOOL_NAME, flowTurnInstructions, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

/** Шапка до сокращения, символов: описание 1558, инструкции 3994, схема 11825 и инструкции хода для четырёх этапов по умолчанию 2514. */
const HEADER_BEFORE = 19_891;
/** Не больше половины прежней шапки. */
const HEADER_LIMIT = Math.floor(HEADER_BEFORE / 2);

const registered = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "A1", now: () => "2026-10-26T10:00:00.000Z", stages: () => ({ stages: [...DEFAULT_STAGES], minButtonWidth: 170 }) });
  const tool = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME);
  if (tool === undefined) throw new Error("ask_decision is not registered");
  return { description: tool.description, instructions: tool.instructions ?? "", schema: JSON.stringify(tool.inputSchema) };
};

describe("шапка Flow в каждом вызове", () => {
  it("описание, инструкции и схема ask_decision вместе с инструкциями хода — не больше половины прежних 19 891 символа", () => {
    const { description, instructions, schema } = registered();
    const total = description.length + instructions.length + schema.length + flowTurnInstructions([...DEFAULT_STAGES]).length;
    expect(HEADER_LIMIT).toBe(9_945);
    expect(total).toBeLessThanOrEqual(HEADER_LIMIT);
  });

  it("схема вызова отдаётся хосту как JSON Schema объекта: без неё агент не соберёт бриф", () => {
    const { schema } = registered();
    expect(JSON.parse(schema)).toMatchObject({ type: "object", required: ["title"] });
  });

  it("инструкции инструмента остаются в пределе bb на инструкции", () => {
    expect(registered().instructions.length).toBeLessThanOrEqual(4096);
  });
});
