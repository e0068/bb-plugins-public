// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief, StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { priced } from "./priced-fixture";
import { createStore } from "./store";

const question = { id: "q", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Да", recommended: true }] };

const host = (stages: StageSettings["stages"]) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const decided: DecisionBrief[] = [];
  registerAskTool(bb, store, { newId: () => "S1", now: () => "2026-10-13T10:00:00.000Z", stages: () => ({ stages, minButtonWidth: 160 }), decided: async (brief) => void decided.push(brief) });
  const ask = async (setup?: object, launched = false) => {
    if (launched) await store.markLaunched("thr");
    // Посреди запущенной работы пункты не шлются: развилка — одни вопросы.
    const params = { title: "Вопросы", questions: [question], ...(setup === undefined ? {} : { setup }) };
    const result = await harness.callAgentTool(ASK_TOOL_NAME, launched ? params : priced(params), { threadId: "thr" });
    return { text: typeof result === "string" ? result : JSON.stringify(result), brief: await store.getBrief("dec_S1"), awaiting: await store.listAwaiting(), decided };
  };
  return { ask };
};

const asked = { stages: [{ id: "questions", state: "todo" }] };

describe("Вопросы в треде с flow ход не держат", () => {
  it("Утверждение впереди — агент работает дальше, ответы владельца придут с ним", async () => {
    const { text, brief, awaiting, decided } = await host([builtinStage("questions", []), builtinStage("approve", [])]).ask({ stages: [...asked.stages, { id: "approve", state: "todo" }] });
    expect(brief?.settle).toBe("approval");
    expect(text).toContain("arrive together with the next approval");
    expect(text).not.toContain("end the turn");
    expect(awaiting).toEqual([]);
    expect(decided).toEqual([]);
  });

  it("Утверждения впереди нет — агент решает сам, и его решение записывается сразу", async () => {
    const { text, brief, decided } = await host([builtinStage("questions", [])]).ask(asked);
    expect(brief?.settle).toBe("agent");
    expect(text).toContain("no approval stands ahead");
    expect(decided.map((b) => b.id)).toEqual(["dec_S1"]);
  });

  it("во flow без «Выбора этапов» бриф Вопросов до запуска приходит без этапов — и всё равно ход не держит", async () => {
    const { text, brief } = await host([builtinStage("questions", []), builtinStage("criteria", []), builtinStage("approve", [])]).ask({ criteria: [{ text: "Пункт", add: { target: 1, max: 2, risk: 1, minutes: 5 } }] });
    expect(brief?.settle).toBe("approval");
    expect(text).not.toContain("end the turn");
  });

  it("развилка посреди запущенной работы — не этап Вопросов: держит ход, как раньше", async () => {
    const { text, brief } = await host([builtinStage("questions", []), builtinStage("approve", [])]).ask(undefined, true);
    expect(brief?.settle).toBeUndefined();
    expect(text).toContain("end the turn");
  });

  it("тред без flow — бриф держит ход, как раньше", async () => {
    const { text, brief } = await host([]).ask();
    expect(brief?.settle).toBeUndefined();
    expect(text).toContain("end the turn");
  });
});
