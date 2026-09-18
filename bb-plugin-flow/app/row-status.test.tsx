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

const respond = (list: unknown) => ({ ok: true, json: async () => ({ ok: true, result: list }) });

const mount = async (lists: unknown[]) => {
  const fetch = vi.fn(async () => respond(lists.length > 1 ? lists.shift() : lists[0]));
  vi.stubGlobal("fetch", fetch);
  const setStatus = vi.fn();
  const script = app.contentScripts.find((s) => s.id === "flow-awaiting")!;
  const context = { pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext;
  const dispose = await script.mount(context);
  return { fetch, setStatus, dispose: dispose as (() => void) | undefined };
};

describe("значок ждущего этапа в строке треда", () => {
  it("ставит значок ждущим тредам по RPC, подпись по виду, стиль маски — в head", async () => {
    vi.useFakeTimers();
    const { fetch, setStatus } = await mount([[{ threadId: "thr_a", kind: "select" }, { threadId: "thr_b", kind: "demo" }]]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledWith("/api/v1/plugins/flow/rpc/awaitingThreads", expect.objectContaining({ method: "POST" }));
    expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Выбор этапов" }));
    expect(setStatus).toHaveBeenCalledWith("thr_b", expect.objectContaining({ label: "Flow — Демонстрация" }));
    const css = document.head.querySelector("style[data-flow-row-glyphs]")?.textContent ?? "";
    expect(css).toContain('[aria-label="Flow — Выбор этапов"]');
    expect(css).toContain("stroke-dasharray");
  });

  it("тред, ушедший из списка на следующем опросе, теряет значок", async () => {
    vi.useFakeTimers();
    const { setStatus } = await mount([[{ threadId: "thr_a", kind: "questions" }], []]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Вопросы" })));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("thr_a", null));
  });

  it("снятие скрипта убирает стиль и все значки", async () => {
    vi.useFakeTimers();
    const { setStatus, dispose } = await mount([[{ threadId: "thr_a", kind: "criteria" }]]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    dispose?.();
    expect(document.head.querySelector("style[data-flow-row-glyphs]")).toBeNull();
    expect(setStatus).toHaveBeenLastCalledWith("thr_a", null);
  });
});
