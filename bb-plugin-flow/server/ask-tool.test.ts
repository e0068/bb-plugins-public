// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { DECISION_ID_PREFIX, directiveLine } from "../core/directive";
import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const forkOption = (id: string, recommended = false) => ({
  id,
  action: `Вариант ${id}`,
  recommended,
  description: "Что произойдёт",
  cost: "~300k токенов",
  risk: "S",
});

const params = (overrides: Record<string, unknown> = {}) => ({
  title: "Как вести работу",
  questions: [
    {
      id: "executor",
      question: "Кто исполняет?",
      kind: "fork",
      options: [forkOption("self", true), forkOption("pipeline")],
    },
  ],
  ...overrides,
});

const setup = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
  const store = createStore(bb.storage.kv);
  let counter = 0;
  registerAskTool(bb, store, { newId: () => `T${++counter}`, now: () => "2026-09-12T12:00:00.000Z" });
  return { harness, store };
};

const textOf = (result: unknown): string =>
  typeof result === "string"
    ? result
    : ((result as { content: Array<{ type: string; text?: string }> }).content ?? [])
        .map((part) => part.text ?? "")
        .join("\n");

describe("инструмент ask_decision", () => {
  it("валидный бриф кладётся в хранилище и возвращает строку директивы с его идентификатором", async () => {
    const { harness, store } = setup();
    const result = await harness.callAgentTool(ASK_TOOL_NAME, params());
    const id = `${DECISION_ID_PREFIX}T1`;
    expect(textOf(result)).toContain(directiveLine(id));
    const stored = await store.getBrief(id);
    expect(stored?.title).toBe("Как вести работу");
    expect(stored?.createdAt).toBe("2026-09-12T12:00:00.000Z");
  });

  it("идентификатор брифа начинается с dec_", async () => {
    const { harness } = setup();
    const text = textOf(await harness.callAgentTool(ASK_TOOL_NAME, params()));
    expect(text).toMatch(/::decision\{id="dec_[^"\s]+"\}/);
  });

  it("threadId брифа берётся из контекста вызова, а не из параметров", async () => {
    const { harness, store } = setup();
    await harness.callAgentTool(ASK_TOOL_NAME, params({ threadId: "thr_forged" }), { threadId: "thr_real" });
    expect((await store.getBrief(`${DECISION_ID_PREFIX}T1`))?.threadId).toBe("thr_real");
  });

  it("бриф сверх предела хранилища возвращает ошибку инструмента с размером", async () => {
    const { harness } = setup();
    const result = await harness.callAgentTool(ASK_TOOL_NAME, params({ intro: "я".repeat(200_000) }));
    expect(typeof result === "object" && result.isError).toBe(true);
    expect(textOf(result)).toMatch(/\d{6,}/);
  });

  it("вызов с двумя рекомендованными в fork отбивается схемой", async () => {
    const { harness } = setup();
    const broken = params({ questions: [{ id: "executor", question: "Кто?", kind: "fork", options: [forkOption("self", true), forkOption("pipeline", true)] }] });
    await expect(harness.callAgentTool(ASK_TOOL_NAME, broken)).rejects.toThrow();
  });

  it("вызов с одним вариантом в вопросе отбивается схемой", async () => {
    const { harness } = setup();
    const broken = params({ questions: [{ id: "executor", question: "Кто?", kind: "fork", options: [forkOption("self", true)] }] });
    await expect(harness.callAgentTool(ASK_TOOL_NAME, broken)).rejects.toThrow();
  });

  it("инструкции инструмента и вклад в инструкции не длиннее 4096 символов", () => {
    const { harness } = setup();
    const tool = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME);
    const contributed = harness.registrations.instructionProvider?.({ threadId: "thr_1", projectId: "prj_1" }) ?? "";
    expect(tool?.instructions?.length ?? 0).toBeGreaterThan(0);
    expect(tool?.instructions?.length ?? Infinity).toBeLessThanOrEqual(4096);
    expect(ASK_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    expect(contributed.length).toBeGreaterThan(0);
    expect(contributed.length).toBeLessThanOrEqual(4096);
  });

  it("вклад в инструкции требует ask_decision для любого вопроса, уточнения, развилки и непонимания — по-английски", () => {
    const { harness } = setup();
    const contributed = (harness.registrations.instructionProvider?.({ threadId: "thr_1", projectId: "prj_1" }) ?? "").toLowerCase();
    expect(contributed).toContain(ASK_TOOL_NAME);
    for (const word of ["question", "clarification", "fork", "confusion"]) expect(contributed).toContain(word);
    expect(contributed).not.toMatch(/[а-яё]/);
  });
});
