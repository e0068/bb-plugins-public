// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CODE_FLOW } from "../core/stages-fixtures";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_required";

const host = async (launched: boolean, stages = CODE_FLOW) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "R1", now: () => "2026-09-30T10:00:00.000Z", stages: () => ({ stages, minButtonWidth: 170 }) });
  return (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const fork = { id: "format", question: "Как?", kind: "fork", options: [{ id: "a", action: "А", description: "а", add: { target: 0, max: 0, risk: 0 }, recommended: true }, { id: "b", action: "Б", description: "б", add: { target: 1, max: 1, risk: 0 } }] };

describe("первый бриф треда, чей flow выбирает этапы, несёт этапы", () => {
  it("бриф до запуска без setup.stages не принимается и называет этапы flow", async () => {
    const ask = await host(false);
    const result = await ask({ title: "Бриф", questions: [fork], setup: { criteria: ["Кнопка на всю ширину"] } });
    expect(typeof result === "object" && result.isError).toBe(true);
    expect(textOf(result)).toContain("setup.stages");
    expect(textOf(result)).toContain("3. select \"Stage selection\"");
  });

  it("уточнение до запуска без этапов принимается", async () => {
    const ask = await host(false);
    const yes = { id: "yes", question: "Так?", kind: "yesno", options: [{ id: "y", action: "Yes" }, { id: "n", action: "No" }] };
    expect(textOf(await ask({ title: "Уточнение", kind: "clarify", questions: [yes] }))).toContain("::decision");
  });

  it("бриф запущенной работы без этапов принимается", async () => {
    const ask = await host(true);
    expect(textOf(await ask({ title: "Развилка", questions: [fork] }))).toContain("::decision");
  });

  it("flow без Выбора этапов бриф без этапов принимает", async () => {
    const ask = await host(false, CODE_FLOW.filter((s) => s.kind !== "select"));
    expect(textOf(await ask({ title: "Бриф", questions: [fork] }))).toContain("::decision");
  });

  it("итог Демонстрации до запуска отбивается своей причиной, а не нехваткой этапов", async () => {
    const ask = await host(false);
    const result = textOf(await ask({ title: "Итог", outcome: { stage: "demo", final: false, next: "Spec", done: ["Прототип"], pending: [], results: [{ label: "Страница", target: "http://localhost:3000" }] } }));
    expect(result).toContain("has not started yet");
    expect(result).not.toContain("setup.stages is missing");
  });
});
