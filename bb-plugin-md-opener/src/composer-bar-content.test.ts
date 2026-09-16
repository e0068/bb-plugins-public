// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountComposerFormatBarIfEnabled } from "./composer-bar-content";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

const contextOf = (pluginId: string, aborted = false) => ({
  pluginId,
  generation: 1,
  signal: aborted ? AbortSignal.abort() : new AbortController().signal,
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll(".mde-fmtbar, .mde-tip").forEach((n) => n.remove());
});

describe("mountComposerFormatBarIfEnabled", () => {
  it("не поднимает панель, когда флаг выключен", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, result: { enabled: false } })));
    const disposer = await mountComposerFormatBarIfEnabled(contextOf("md-opener"));
    expect(disposer).toBeUndefined();
    expect(document.querySelector(".mde-fmtbar")).toBeNull();
  });

  it("поднимает панель и возвращает disposer, когда флаг включён", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, result: { enabled: true } })));
    const disposer = await mountComposerFormatBarIfEnabled(contextOf("md-opener"));
    expect(typeof disposer).toBe("function");
    expect(document.querySelector(".mde-fmtbar")).not.toBeNull();
    disposer?.();
    expect(document.querySelector(".mde-fmtbar")).toBeNull();
  });

  it("не поднимает панель при ошибке ответа RPC", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const disposer = await mountComposerFormatBarIfEnabled(contextOf("md-opener"));
    expect(disposer).toBeUndefined();
  });

  it("не поднимает панель, когда fetch бросает", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const disposer = await mountComposerFormatBarIfEnabled(contextOf("md-opener"));
    expect(disposer).toBeUndefined();
  });

  it("зовёт RPC этого плагина по его id из контекста", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, result: { enabled: false } }));
    vi.stubGlobal("fetch", fetchMock);
    await mountComposerFormatBarIfEnabled(contextOf("another-id"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/another-id/rpc/composerBarEnabled",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("не поднимает панель, если сигнал отменён к моменту ответа", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true, result: { enabled: true } })));
    const disposer = await mountComposerFormatBarIfEnabled(contextOf("md-opener", true));
    expect(disposer).toBeUndefined();
  });
});
