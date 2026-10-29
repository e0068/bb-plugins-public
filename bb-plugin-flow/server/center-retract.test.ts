// @vitest-environment node
//
// Снятое ожидание отзывает карточку в центре: хранилище Flow, обёрнутое
// retractOnSettle, после clearAwaiting шлёт центру отзыв ключа брифа. Центр —
// поддельный fetch; хранилище настоящее, на kv поддельного хоста.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { centerBridge, retractOnSettle } from "./center";
import { createStore } from "./store";

const RETRACT = "/api/v1/plugins/notifications/http/retract";

type Sent = { url: string; body: unknown };

/** Центр в памяти: запросы записываются; `answer` решает, что он отвечает. */
const world = (answer: () => Response | Promise<Response> = () => new Response("{}", { status: 200 })) => {
  const sent: Sent[] = [];
  const warned: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return answer();
  }) as unknown as typeof fetch;
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  const center = centerBridge({ server: { loopbackBaseUrl: "http://loop" }, log: { warn: (m: string) => void warned.push(m) } }, fetchImpl);
  const base = createStore(bb.storage.kv);
  return { sent, warned, base, store: retractOnSettle(base, center) };
};

describe("retractOnSettle", () => {
  it("снятое ожидание отзывает у центра ключ брифа", async () => {
    const { store, sent } = world();
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    await store.clearAwaiting("thr_1", "dec_1");
    await new Promise((resolve) => setTimeout(resolve));
    expect(sent).toEqual([{ url: `http://loop${RETRACT}`, body: { source: "flow", dedupeKey: "brief:dec_1" } }]);
  });

  it("само ожидание снимается, как у хранилища без обёртки", async () => {
    const { store, base } = world();
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    await store.clearAwaiting("thr_1", "dec_1");
    expect(await base.listAwaiting()).toEqual([]);
  });

  it("ответ на бриф, чьё ожидание уже сменилось, всё равно отзывает его карточку, а новое ожидание остаётся", async () => {
    const { store, base, sent } = world();
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    await store.putAwaiting("thr_1", { briefId: "automation:merge", kind: "automation" });
    await store.clearAwaiting("thr_1", "dec_1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await base.listAwaiting()).map((e) => e.briefId)).toEqual(["automation:merge"]);
    expect(sent).toEqual([{ url: `http://loop${RETRACT}`, body: { source: "flow", dedupeKey: "brief:dec_1" } }]);
  });

  it("ожидание этапа-автоматизации или Action снимается без отзыва: карточки «Ждёт ответа» у него нет", async () => {
    const { store, base, sent } = world();
    await store.putAwaiting("thr_1", { briefId: "automation:merge", kind: "automation" });
    await store.putAwaiting("thr_2", { briefId: "action:land", kind: "action" });
    await store.clearAwaiting("thr_1", "automation:merge");
    await store.clearAwaiting("thr_2", "action:land");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await base.listAwaiting()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("центр не установлен — тихо, без предупреждения", async () => {
    const { store, warned } = world(() => new Response("{}", { status: 404 }));
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    await store.clearAwaiting("thr_1", "dec_1");
    await new Promise((resolve) => setTimeout(resolve));
    expect(warned).toEqual([]);
  });

  it("центр не ответил — предупреждение в журнал, а снятие ожидания не падает и уже сделано", async () => {
    const { store, base, warned } = world(() => Promise.reject(new TypeError("fetch failed")));
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    await expect(store.clearAwaiting("thr_1", "dec_1")).resolves.toBeUndefined();
    await vi_waitFor(() => warned.length > 0);
    expect(await base.listAwaiting()).toEqual([]);
    expect(warned[0]).toContain("brief:dec_1");
  });

  it("не ждёт центра: снятие возвращается, пока отзыв ещё в пути", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { store } = world(async () => {
      await gate;
      return new Response("{}", { status: 200 });
    });
    await store.putAwaiting("thr_1", { briefId: "dec_1", kind: "questions" });
    const settled = await Promise.race([store.clearAwaiting("thr_1", "dec_1").then(() => "returned"), new Promise((resolve) => setTimeout(() => resolve("waited"), 200))]);
    release();
    expect(settled).toBe("returned");
  });

  it("остальные методы хранилища проходят насквозь", async () => {
    const { store } = world();
    await store.putAwaiting("thr_9", { briefId: "dec_9", kind: "approve" });
    expect(await store.listAwaiting()).toEqual([{ threadId: "thr_9", briefId: "dec_9", kind: "approve" }]);
  });
});

async function vi_waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !check(); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}
