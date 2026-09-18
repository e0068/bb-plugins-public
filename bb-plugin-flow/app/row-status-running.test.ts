// @vitest-environment jsdom
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

/** Ответы RPC по имени метода — ждущие и идущие треды. */
const mount = async (answers: { awaiting: unknown[]; running: unknown[] }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ok: true, result: String(url).endsWith("runningThreads") ? answers.running : answers.awaiting }) })),
  );
  const setStatus = vi.fn();
  const script = app.contentScripts.find((s) => s.id === "flow-awaiting")!;
  await script.mount({ pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext);
  return setStatus;
};

const css = () => document.head.querySelector("style[data-flow-row-glyphs]")?.textContent ?? "";

describe("значок идущего этапа в строке треда", () => {
  it("идущий тред получает мигающий значок вида этапа", async () => {
    const setStatus = await mount({ awaiting: [], running: [{ threadId: "thr_a", icon: "automation" }, { threadId: "thr_b", icon: "agent" }] });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Автоматизация · идёт" }));
    expect(setStatus).toHaveBeenCalledWith("thr_b", expect.objectContaining({ label: "Flow — Агент · идёт" }));
    const rule = css().split("\n").find((line) => line.includes('[aria-label="Flow — Автоматизация · идёт"]{'));
    expect(rule).toMatch(/animation:/);
  });

  it("ждущий тред важнее идущего", async () => {
    const setStatus = await mount({ awaiting: [{ threadId: "thr_a", kind: "demo" }], running: [{ threadId: "thr_a", icon: "self" }] });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Демонстрация" }));
  });

  it("упавшая автоматизация — ровный значок в тоне ошибки", async () => {
    const setStatus = await mount({ awaiting: [{ threadId: "thr_a", kind: "automation" }], running: [] });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Автоматизация остановилась", tone: "error" }));
    const rule = css().split("\n").find((line) => line.includes('[aria-label="Flow — Автоматизация остановилась"]{'));
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/animation:/);
  });
});
