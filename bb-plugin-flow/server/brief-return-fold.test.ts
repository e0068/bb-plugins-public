// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { AwaitingKind } from "../shared/contract";
import { returnAwaitingBrief } from "./brief-return";
import { createStore } from "./store";

const THREAD = "thr_1";

const host = async (waits: { briefId: string; kind: AwaitingKind }, group?: string[]) => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const published: string[] = [];
  if (group !== undefined) {
    await store.putThreadGroup(THREAD, { ids: group, lastApprove: waits.kind === "approve", folded: false });
    await store.putApprovalGroup(waits.briefId, group);
  }
  await store.putAwaiting(THREAD, waits);
  const returned = await returnAwaitingBrief({ store, publish: (id) => void published.push(id) }, THREAD);
  return { store, published, returned };
};

describe("сообщение в чат при ждущем утверждении", () => {
  it("сворачивает всю группу — виджеты от прошлого утверждения: каждый перечитывается, указатель возврата стоит на утверждении", async () => {
    const { store, published, returned } = await host({ briefId: "ok", kind: "approve" }, ["q", "d", "ok"]);
    expect(returned).toBe("ok");
    expect(published).toEqual(["q", "d", "ok"]);
    expect(await store.getFold("q")).toEqual({ holder: "ok", ids: ["q", "d", "ok"] });
    expect(await store.getThreadReturned(THREAD)).toBe("ok");
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("тред без списка группы: сворачивается одно утверждение", async () => {
    const { store, published } = await host({ briefId: "ok", kind: "approve" });
    expect(published).toEqual(["ok"]);
    expect(await store.getFold("ok")).toEqual({ holder: "ok", ids: ["ok"] });
  });

  it("утверждение, свёрнутое сообщением, закрывает группу: следующее утверждение без доработок будет отбито", async () => {
    const { store } = await host({ briefId: "ok", kind: "approve" }, ["q", "ok"]);
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["q", "ok"], lastApprove: true, folded: true });
  });
});

describe("сообщение в чат при ждущем не утверждении", () => {
  it.each(["questions", "criteria", "select", "demo"] as const)("ожидание вида %s сворачивает в строку только себя, остальные виджеты группы остаются", async (kind) => {
    const { store, published } = await host({ briefId: "w", kind }, ["q", "w"]);
    expect(published).toEqual(["w"]);
    expect(await store.getFold("w")).toEqual({ holder: "w", ids: ["w"] });
    expect(await store.getFold("q")).toBeNull();
    expect(await store.getThreadReturned(THREAD)).toBe("w");
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["q", "w"], lastApprove: false, folded: false });
  });
});
