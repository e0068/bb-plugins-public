// @vitest-environment node
// Отвеченные брифы треда для журнала прогона: новые запоминаются при ответе
// вместе с путём файла, данные раньше собираются из брифов один раз на все треды.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { createJournalIndex } from "./journal-index";
import { createStore } from "./store";

const brief = (id: string, threadId: string, title: string, kind: "brief" | "clarify" = "brief"): DecisionBrief => ({
  id,
  threadId,
  title,
  createdAt: "2026-09-30T06:00:00.000Z",
  kind,
  questions: [{ id: "q", question: "Что?", kind: "yesno", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
});

const answered = async (store: ReturnType<typeof createStore>, b: DecisionBrief, answeredAt: string) => {
  await store.putBrief(b);
  await store.putAnswer(b.id, { answer: { briefId: b.id, answers: [{ questionId: "q", optionIds: ["yes"] }] }, messageId: "m", answeredAt });
};

const setup = () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let lists = 0;
  const kv = { ...bb.storage.kv, list: (prefix?: string) => ((lists += 1), bb.storage.kv.list(prefix)) };
  return { store, index: createJournalIndex(kv, store), lists: () => lists };
};

describe("индекс журнала по тредам", () => {
  it("записанный при ответе бриф возвращается с путём файла", async () => {
    const { index } = setup();
    await index.record("thr_a", { briefId: "b1", title: "Запуск", answeredAt: "2026-09-30T07:00:00.000Z", path: "docs/flows/zapusk.md" });
    await index.record("thr_a", { briefId: "b2", title: "Демо", answeredAt: "2026-09-30T08:00:00.000Z" });
    expect(await index.entries("thr_a")).toEqual([
      { briefId: "b1", title: "Запуск", answeredAt: "2026-09-30T07:00:00.000Z", path: "docs/flows/zapusk.md" },
      { briefId: "b2", title: "Демо", answeredAt: "2026-09-30T08:00:00.000Z" },
    ]);
  });

  it("брифы, отвеченные до индекса, собираются из хранилища; уточнения и неотвеченные не входят", async () => {
    const { store, index } = setup();
    await answered(store, brief("b1", "thr_a", "Запуск"), "2026-09-30T07:00:00.000Z");
    await answered(store, brief("c1", "thr_a", "Уточнение", "clarify"), "2026-09-30T07:30:00.000Z");
    await store.putBrief(brief("b3", "thr_a", "Без ответа"));
    await answered(store, brief("b2", "thr_b", "Чужой"), "2026-09-30T08:00:00.000Z");
    expect(await index.entries("thr_a")).toEqual([{ briefId: "b1", title: "Запуск", answeredAt: "2026-09-30T07:00:00.000Z" }]);
    expect(await index.entries("thr_b")).toEqual([{ briefId: "b2", title: "Чужой", answeredAt: "2026-09-30T08:00:00.000Z" }]);
  });

  it("сбор из хранилища идёт один раз на все треды", async () => {
    const { store, index, lists } = setup();
    await answered(store, brief("b1", "thr_a", "Запуск"), "2026-09-30T07:00:00.000Z");
    await index.entries("thr_a");
    const after = lists();
    await index.entries("thr_b");
    await index.entries("thr_a");
    expect(lists()).toBe(after);
  });

  it("запись с путём, сделанная до сбора, сбором не затирается", async () => {
    const { store, index } = setup();
    await answered(store, brief("b1", "thr_a", "Запуск"), "2026-09-30T07:00:00.000Z");
    await index.record("thr_a", { briefId: "b1", title: "Запуск", answeredAt: "2026-09-30T07:00:00.000Z", path: "docs/flows/zapusk-2.md" });
    expect(await index.entries("thr_a")).toEqual([{ briefId: "b1", title: "Запуск", answeredAt: "2026-09-30T07:00:00.000Z", path: "docs/flows/zapusk-2.md" }]);
  });

  it("одновременные ответы одного треда не теряют друг друга", async () => {
    const { index } = setup();
    await Promise.all(["b1", "b2", "b3"].map((briefId, i) => index.record("thr_a", { briefId, title: briefId, answeredAt: `2026-09-30T0${i + 1}:00:00.000Z` })));
    expect((await index.entries("thr_a")).map(({ briefId }) => briefId).sort()).toEqual(["b1", "b2", "b3"]);
  });
});
