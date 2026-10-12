// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "./store";

const THREAD = "thr_1";

const fresh = () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  return { store: createStore(bb.storage.kv), kv: bb.storage.kv };
};

describe("список группы треда", () => {
  it("записанный список читается, а треда без списка — null", async () => {
    const { store } = fresh();
    expect(await store.getThreadGroup(THREAD)).toBeNull();
    await store.putThreadGroup(THREAD, { ids: ["a", "b"], lastApprove: false, folded: false });
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["a", "b"], lastApprove: false, folded: false });
  });

  it("чужая запись под ключом — отсутствие списка, а не падение", async () => {
    const { store, kv } = fresh();
    await kv.set(`decision-thread-group:${THREAD}`, { ids: "нет" });
    expect(await store.getThreadGroup(THREAD)).toBeNull();
  });
});

describe("свёртка группы утверждением", () => {
  it("виджеты из снимка группы утверждения: каждый знает держателя и всю группу, помечен возвращённым", async () => {
    const { store } = fresh();
    await store.putApprovalGroup("ok", ["q", "d", "ok"]);
    expect(await store.foldGroup(THREAD, "ok")).toEqual(["q", "d", "ok"]);
    for (const id of ["q", "d", "ok"]) {
      expect(await store.getFold(id)).toEqual({ holder: "ok", ids: ["q", "d", "ok"] });
      expect(await store.isReturned(id)).toBe(true);
    }
  });

  it("список треда только получает пометку свёртки, ids в нём не переписываются: после утверждения мог прийти другой бриф", async () => {
    const { store } = fresh();
    await store.putApprovalGroup("ok", ["q", "ok"]);
    await store.putThreadGroup(THREAD, { ids: ["c1"], lastApprove: false, folded: false });
    expect(await store.foldGroup(THREAD, "ok")).toEqual(["q", "ok"]);
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["c1"], lastApprove: false, folded: true });
  });

  it("у треда нет списка — он появляется со свёрнутым утверждением, чтобы следующее голое утверждение было отбито", async () => {
    const { store } = fresh();
    await store.putApprovalGroup("ok", ["q", "ok"]);
    await store.foldGroup(THREAD, "ok");
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["q", "ok"], lastApprove: true, folded: true });
  });

  it("снимка нет (тред начат до групп) — группа из одного утверждения", async () => {
    const { store } = fresh();
    expect(await store.foldGroup(THREAD, "ok")).toEqual(["ok"]);
    expect(await store.getFold("ok")).toEqual({ holder: "ok", ids: ["ok"] });
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["ok"], lastApprove: true, folded: true });
  });

  it("чужая запись под ключом снимка — отсутствие снимка", async () => {
    const { store, kv } = fresh();
    await kv.set("decision-approval-group:ok", "нет");
    expect(await store.foldGroup(THREAD, "ok")).toEqual(["ok"]);
  });

  it("позднейшая свёртка забирает виджет себе: свёрнутый ранее в одиночку становится членом группы", async () => {
    const { store } = fresh();
    await store.foldSingle("q");
    expect(await store.getFold("q")).toEqual({ holder: "q", ids: ["q"] });
    await store.putApprovalGroup("ok", ["q", "ok"]);
    await store.foldGroup(THREAD, "ok");
    expect(await store.getFold("q")).toEqual({ holder: "ok", ids: ["q", "ok"] });
  });
});

describe("свёртка одного виджета", () => {
  it("виджет — группа из одного, помечен возвращённым; список треда не меняется", async () => {
    const { store } = fresh();
    await store.putThreadGroup(THREAD, { ids: ["q", "w"], lastApprove: false, folded: false });
    expect(await store.foldSingle("w")).toEqual(["w"]);
    expect(await store.getFold("w")).toEqual({ holder: "w", ids: ["w"] });
    expect(await store.isReturned("w")).toBe(true);
    expect(await store.getFold("q")).toBeNull();
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["q", "w"], lastApprove: false, folded: false });
  });

  it("несвёрнутый виджет свёртки не имеет; запись держателя без списка группы — тоже не свёртка", async () => {
    const { store, kv } = fresh();
    expect(await store.getFold("none")).toBeNull();
    await kv.set("decision-fold:x", "h");
    expect(await store.getFold("x")).toBeNull();
  });
});
