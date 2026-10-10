// @vitest-environment node
// Описание инструмента choose_flow модель видит каждый ход рядом с правилом выбора: в треде, который агент оставил без flow,
// оно не должно ждать просьбы владельца, иначе спорит с правилом.
import { describe, expect, it } from "vitest";

import { registerChooseFlow } from "./choose-flow";

const registered = (): { description: string; parameters: { shape: { flowId: { description?: string } } } } => {
  let tool: unknown;
  const bb = { agents: { registerTool: (t: unknown) => void (tool = t) } } as unknown as Parameters<typeof registerChooseFlow>[0];
  registerChooseFlow(bb, {} as Parameters<typeof registerChooseFlow>[1]);
  return tool as ReturnType<typeof registered>;
};

describe("описание инструмента choose_flow", () => {
  it("в треде без flow по выбору агента выбор не ждёт просьбы владельца", () => {
    const { description } = registered();
    expect(description).not.toMatch(/owner (asks|requests|wants)/i);
    expect(description).toMatch(/thread you left without one/);
  });

  it("называет отказ от flow и для «flow не нужен», и для «ни один не подошёл»", () => {
    expect(registered().parameters.shape.flowId.description).toMatch(/no flow is needed or none of them fits/);
  });
});
