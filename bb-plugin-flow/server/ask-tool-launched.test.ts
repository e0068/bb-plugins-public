// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };

const THREAD = "thr_run";

const host = async (options: { launched?: boolean } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (options.launched === true) await store.markLaunched(THREAD);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `S${++n}`, now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
  const idOf = (result: unknown) => /id="(dec_[^"]+)"/.exec(typeof result === "string" ? result : "")?.[1] ?? "";
  const ask = (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
  return { harness, store, idOf, ask };
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const stages = STAGES.map((stage, i) => ({ id: stage.id, state: "todo", recommended: i === 0 }));

const outcome = {
  stage: STAGES[0]?.id ?? "task",
  final: false,
  next: "Спецификация",
  done: ["Задача заведена"],
  pending: [],
  results: [{ label: "task.md", target: "memory/tasks/task.md" }],
};

describe("бриф в запущенном треде", () => {
  it("этапы после запуска не принимаются", async () => {
    const { ask } = await host({ launched: true });
    const result = await ask({ title: "Бриф", setup: { stages } });
    expect(textOf(result)).toContain("already launched");
  });

  it("«Готово, когда» после запуска не принимается", async () => {
    const { ask } = await host({ launched: true });
    const result = await ask({ title: "Бриф", setup: { criteria: ["Тесты зелёные"] } });
    expect(textOf(result)).toContain("already launched");
  });

  it("вопросы после запуска принимаются как были", async () => {
    const { ask, store, idOf } = await host({ launched: true });
    const result = await ask({
      title: "Чем рисовать список",
      questions: [
        { id: "ui", question: "Панель или поповер?", kind: "fork", options: [
          { id: "panel", action: "Панель", description: "Не перекрывает ленту", cost: "$0", risk: "S" },
          { id: "pop", action: "Поповер", description: "Перекрывает соседей", cost: "$0", risk: "M" },
        ] },
      ],
    });
    expect(await store.getBrief(idOf(result))).not.toBeNull();
  });

  it("бриф до запуска метки не несёт", async () => {
    const { ask, store, idOf } = await host();
    const result = await ask({ title: "Бриф", setup: { stages } });
    expect((await store.getBrief(idOf(result)))?.launched).toBeUndefined();
  });

  it("до запуска этапы принимаются", async () => {
    const { ask, store, idOf } = await host();
    const result = await ask({ title: "Бриф", setup: { stages } });
    expect((await store.getBrief(idOf(result)))?.setup?.stages).toHaveLength(STAGES.length);
  });
});

describe("итог этапа", () => {
  it("итог по этапу не из настроек отбивается", async () => {
    const { ask } = await host({ launched: true });
    const result = await ask({ title: "Итог", outcome: { ...outcome, stage: "nope" } });
    expect(textOf(result)).toContain("nope");
  });

  it("итог до запуска работы отбивается", async () => {
    const { ask } = await host();
    const result = await ask({ title: "Итог", outcome });
    expect(textOf(result)).toContain("not started yet");
  });
});
