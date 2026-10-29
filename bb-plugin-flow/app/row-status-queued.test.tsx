// @vitest-environment jsdom
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

const THREADS_URL = "/api/v1/threads?archived=false";

/** Ответ списка тредов хоста на каждом опросе по очереди; `"fail"` — сбой запроса. */
const mount = async (hostThreads: readonly unknown[], awaiting: unknown[]) => {
  const queue = [...hostThreads];
  const fetch = vi.fn(async (url: string) => {
    if (String(url) === THREADS_URL) {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === "fail") throw new Error("offline");
      if (next === "not-ok") return { ok: false, json: async () => [] };
      return { ok: true, json: async () => next };
    }
    return { ok: true, json: async () => ({ ok: true, result: String(url).endsWith("awaitingThreads") ? awaiting : [] }) };
  });
  vi.stubGlobal("fetch", fetch);
  const setStatus = vi.fn();
  const script = app.contentScripts.find((s) => s.id === "flow-awaiting")!;
  await script.mount({ pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext);
  return { fetch, setStatus };
};

const AWAITING = [{ threadId: "thr_a", kind: "questions" }, { threadId: "thr_b", kind: "demo" }];

describe("значок Flow у треда с сообщением в очереди хоста", () => {
  it("список тредов хоста просят без архивных", async () => {
    vi.useFakeTimers();
    const { fetch, setStatus } = await mount([[]], AWAITING);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith(THREADS_URL);
  });

  it.each(["waiting", "failed"])("тред с очередью %s значка не получает, остальные — получают", async (queuedWork) => {
    vi.useFakeTimers();
    const { setStatus } = await mount([[{ id: "thr_a", queuedWork }, { id: "thr_b", queuedWork: "none" }]], AWAITING);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_b", expect.objectContaining({ label: "Flow — Демонстрация" }));
    expect(setStatus).not.toHaveBeenCalledWith("thr_a", expect.anything());
  });

  it("значок, поставленный раньше, снимается, когда тред встал в очередь, и ставится снова, когда она ушла", async () => {
    vi.useFakeTimers();
    const none = [{ id: "thr_a", queuedWork: "none" }];
    const waiting = [{ id: "thr_a", queuedWork: "waiting" }];
    const { setStatus } = await mount([none, waiting, none], [AWAITING[0]]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Вопросы" })));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith("thr_a", null));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(setStatus).toHaveBeenLastCalledWith("thr_a", expect.objectContaining({ label: "Flow — Вопросы" })));
  });

  it.each([[{ not: "array" }], [null], ["text"]])("ответ хоста не массив (%j) очередью не считается — значки как прежде", async (answer) => {
    vi.useFakeTimers();
    const { setStatus } = await mount([answer], AWAITING);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
  });

  it.each([["fail"], ["not-ok"]])("сбой запроса (%s) оставляет прошлое множество: значок снятого треда не возвращается", async (failure) => {
    vi.useFakeTimers();
    const waiting = [{ id: "thr_a", queuedWork: "waiting" }];
    const { setStatus } = await mount([waiting, failure], [AWAITING[0], AWAITING[1]]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_b", expect.objectContaining({ label: "Flow — Демонстрация" }));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalledWith("thr_a", expect.anything());
  });

  it("сбой запроса на первом опросе — пустое множество: значки как до очереди", async () => {
    vi.useFakeTimers();
    const { setStatus } = await mount(["fail"], AWAITING);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
  });
});
