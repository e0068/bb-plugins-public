// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES, planner } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };

const host = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
  const store = createStore(bb.storage.kv);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `S${++n}`, now: () => "2026-09-15T00:00:00.000Z", stages: () => settings });
  const idOf = (result: unknown) => /id="(dec_[^"]+)"/.exec(typeof result === "string" ? result : "")?.[1] ?? "";
  return { harness, store, idOf };
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const reports = [
  { id: "task", state: "done", results: [{ label: "BBPL-1", target: "docs/tasks/BBPL-1.md" }] },
  { id: "spec", state: "todo", recommended: true },
  { id: "plan", state: "todo", executor: planner.id, adds: { [planner.id]: { target: 1, max: 2, risk: 0 } } },
];

describe("ask_decision и этапы работ", () => {
  it("бриф с этапами хранит снимок настроек", async () => {
    const { harness, store, idOf } = host();
    const brief = await store.getBrief(idOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: reports } })));
    expect(brief?.stages).toEqual({ list: STAGES, minButtonWidth: 190 });
    expect(brief?.setup?.stages?.map((s) => s.id)).toEqual(["task", "spec", "plan"]);
  });

  it("бриф без этапов снимка не получает", async () => {
    const { harness, store, idOf } = host();
    const result = await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { criteria: ["Тесты зелёные"] } });
    expect((await store.getBrief(idOf(result)))?.stages).toBeUndefined();
  });

  it("отчёт не по настройкам — ошибка инструмента со списком этапов настроек", async () => {
    const { harness } = host();
    const result = await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: reports.slice(1) } });
    expect(typeof result === "object" && result.isError).toBe(true);
    expect(textOf(result)).toContain("task, spec, plan");
  });

  it("артефакты, исполнитель, ревью и тестирование прежнего вида отбиваются с отсылкой к setup.stages", async () => {
    const { harness } = host();
    for (const setup of [{ executor: { recommended: "self" } }, { checker: { recommended: "none" } }, { testing: { recommended: "self" } }]) {
      const result = await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup });
      expect(typeof result === "object" && result.isError).toBe(true);
      expect(textOf(result)).toContain("setup.stages");
    }
  });

  it("перенос этапов из прошлого брифа треда встаёт в новый бриф с этапами", async () => {
    const { harness, store, idOf } = host();
    const first = await store.getBrief(idOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Первый", setup: { stages: reports } })));
    await store.putThreadCarry(first!.threadId, { "stage:plan:executor": [planner.id], "stage:ghost:review": ["on"] });
    const second = await store.getBrief(idOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Второй", setup: { stages: reports } })));
    expect(second?.carried).toEqual({ "stage:plan:executor": [planner.id] });
  });

});
