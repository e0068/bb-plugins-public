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

/** Оба опроса строки: ждущие владельца и треды, где идёт работа. */
const mount = async (awaiting: unknown[], running: unknown[] = []) => {
  vi.stubGlobal("fetch", async (url: string) => respond(String(url).endsWith("awaitingThreads") ? awaiting : running));
  const setStatus = vi.fn();
  const script = app.contentScripts.find((s) => s.id === "flow-awaiting")!;
  const context = { pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext;
  await script.mount(context);
  return { setStatus };
};

describe("этап Action в строке треда левой панели", () => {
  it("тред, ждущий нажатия на этапе Action, показывает его значок", async () => {
    vi.useFakeTimers();
    const { setStatus } = await mount([{ threadId: "thr_a", kind: "action" }]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Action" })));
  });

  it("идущий шаг Action мерцает своим значком, а не значком автоматизации", async () => {
    vi.useFakeTimers();
    const { setStatus } = await mount([], [{ threadId: "thr_b", icon: "action" }]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith("thr_b", expect.objectContaining({ label: "Flow — Action · идёт" })));
  });
});
