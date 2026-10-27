// @vitest-environment node
// Фейковый хост SDK отдаёт loopback с портом живого bb. Запрос теста, который
// пережил свою заглушку `fetch`, уходил в настоящий bb: так центр уведомлений
// набрал записи «Автоматизация «Merge» прошла» у тестового треда thr_auto.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const base = createFakePluginHost({ pluginId: "flow" }).bb.server.loopbackBaseUrl;
const { port } = new URL(base);
const LIVE = [`${base}/api/v1/plugins/notifications/http/push`, `http://localhost:${port}/`, `http://[::1]:${port}/`];

describe("тесты Flow не достают до живого bb", () => {
  it.each(LIVE)("запрос на loopback %s без своей заглушки падает, а не уходит в bb", async (url) => {
    await expect(fetch(url)).rejects.toThrow(/живой bb/);
  });

  it("запрос на loopback, переданный объектом Request, тоже падает", async () => {
    await expect(fetch(new Request(LIVE[0]!))).rejects.toThrow(/живой bb/);
  });

  it("снятая заглушка возвращает сторожа, а не настоящий fetch", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}"));
    expect((await fetch(LIVE[0]!)).ok).toBe(true);
    vi.unstubAllGlobals();
    await expect(fetch(LIVE[0]!)).rejects.toThrow(/живой bb/);
  });
});
