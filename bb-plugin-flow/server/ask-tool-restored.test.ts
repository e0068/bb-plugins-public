// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { ASK_TOOL_NAME, RETURNED_RULE, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_restored";
const DRAFT = JSON.stringify({ entries: { route: { optionIds: ["b"], own: "" } }, note: "", criteria: { removed: [0], edited: {}, added: [] }, budget: { target: "", max: "" }, stages: {} });

const fork = { id: "route", question: "Куда?", kind: "fork", options: [{ id: "a", action: "A", description: "a", add: { target: 0, max: 0, risk: 0 } }, { id: "b", action: "B", description: "b", add: { target: 0, max: 0, risk: 0 } }] };
const brief = (title: string, kind: "brief" | "clarify" = "brief") =>
  kind === "clarify"
    ? { title, kind, questions: [{ id: "ok", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Yes" }, { id: "no", action: "No" }] }] }
    : { title, scope: "- работа", setup: { criteria: [{ text: "Пункт", add: { target: 1, max: 2, risk: 0, minutes: 5 } }] }, questions: [fork] };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `K${++n}`, now: () => "2026-10-02T10:00:00.000Z" });
  const ask = async (input: unknown) => textOf(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
  return { ask, store, harness };
};

describe("бриф взамен возвращённого получает черновик владельца", () => {
  it("новый бриф треда несёт черновик и пункты возвращённого, ответ инструмента говорит о предвыборе, второй бриф его уже не получает", async () => {
    const { ask, store } = await host();
    await ask(brief("Первый"));
    await store.putDraft("dec_K1", DRAFT);
    await store.putThreadReturned(THREAD, "dec_K1");
    expect(await ask(brief("Второй"))).toMatch(/preselected/);
    expect((await store.getBrief("dec_K2"))?.restored).toEqual({ draft: DRAFT, criteria: ["Пункт"] });
    expect(await store.getThreadReturned(THREAD)).toBeNull();
    await ask(brief("Третий"));
    expect((await store.getBrief("dec_K3"))?.restored).toBeUndefined();
  });

  it("бриф взамен возвращённого вернули снова, не тронув: третий получает тот же выбор, черновик забранного снят", async () => {
    const { ask, store } = await host();
    await ask(brief("Первый"));
    await store.putDraft("dec_K1", DRAFT);
    await store.putThreadReturned(THREAD, "dec_K1");
    await ask(brief("Второй"));
    expect(await store.getDraft("dec_K1")).toBeNull();
    await store.putThreadReturned(THREAD, "dec_K2");
    await ask(brief("Третий"));
    expect((await store.getBrief("dec_K3"))?.restored).toEqual({ draft: DRAFT, criteria: ["Пункт"] });
  });

  it("уточнение возвращённый бриф не забирает: черновик ждёт брифа", async () => {
    const { ask, store } = await host();
    await ask(brief("Первый"));
    await store.putDraft("dec_K1", DRAFT);
    await store.putThreadReturned(THREAD, "dec_K1");
    await ask(brief("Уточнение", "clarify"));
    expect(await store.getThreadReturned(THREAD)).toBe("dec_K1");
  });

  it("правило про сообщение вместо ответа — в описании инструмента", async () => {
    const { harness } = await host();
    const tool = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME);
    expect(tool?.description).toContain(RETURNED_RULE);
  });
});
