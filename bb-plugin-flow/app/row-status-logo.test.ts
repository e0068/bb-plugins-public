// @vitest-environment jsdom
import type { PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

const LOGO = "/api/v1/system/providers/claude-code/logo?h=1";

/** Ответы RPC по имени метода; не названный метод отвечает пустым списком. */
const mount = async (answers: Record<string, unknown[]>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ok: true, result: answers[String(url).split("/").at(-1)!] ?? [] }) })),
  );
  const setStatus = vi.fn();
  await app.contentScripts.find((s) => s.id === "flow-awaiting")!.mount({ pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext);
  return setStatus;
};

const css = () => document.head.querySelector("style[data-flow-row-glyphs]")?.textContent ?? "";

describe("строка треда с flow во время хода агента", () => {
  it("колёсико хода получает логотип провайдера треда", async () => {
    await mount({ agentLogos: [{ threadId: "thr_a", logoUrl: LOGO }] });
    await vi.waitFor(() => expect(css()).toContain('a[data-sidebar-thread-id="thr_a"]'));
    const rule = css().split("\n").find((line) => line.includes('a[data-sidebar-thread-id="thr_a"]') && line.includes("mask-image"));
    expect(rule).toContain('[data-icon="Loading"]');
    expect(rule).toContain(`url("${LOGO}")`);
  });

  it("этап навыка своего значка в строке не ставит — ни во время хода, ни после", async () => {
    const setStatus = await mount({ runningThreads: [{ threadId: "thr_a", icon: "self" }, { threadId: "thr_b", icon: "agent" }, { threadId: "thr_c", icon: "automation" }] });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_c", expect.objectContaining({ label: "Flow — Автоматизация · идёт" }));
    const rule = css().split("\n").find((line) => line.includes('[aria-label="Flow — Автоматизация · идёт"]{'));
    expect(rule).toMatch(/animation:/);
  });
});

describe("ждущий и идущий в одной строке", () => {
  it("ждущий владельца важнее идущей автоматизации", async () => {
    const setStatus = await mount({ awaitingThreads: [{ threadId: "thr_a", kind: "demo" }], runningThreads: [{ threadId: "thr_a", icon: "automation" }] });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1));
    expect(setStatus).toHaveBeenCalledWith("thr_a", expect.objectContaining({ label: "Flow — Демонстрация" }));
  });
});
