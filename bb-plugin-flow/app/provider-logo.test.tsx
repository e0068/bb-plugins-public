// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { PluginContentScriptContext, PluginMessageDirectiveProps, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planner, report, stagedBrief } from "../core/stages-fixtures";
import type { FlowSettings, decisionsRpcContract, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  window.localStorage.clear();
});

const CLAUDE_LOGO = "/api/v1/system/providers/claude-code/logo?h=1";
const CODEX_LOGO = "/api/v1/system/providers/codex/logo?h=2";
const providers = {
  status: "ready",
  providers: [
    { id: "claude-code", displayName: "Claude Code", logoUrl: CLAUDE_LOGO },
    { id: "codex", displayName: "Codex", logoUrl: CODEX_LOGO },
    { id: "bare", displayName: "Bare", logoUrl: null },
  ],
} as never;

const skill = (id: string, executor: "self" | "agent" | "workflow", provider?: string) => ({ id, kind: "skill", name: id, executor, state: "done", results: [], minutes: 1, cost: null, ...(provider === undefined ? {} : { provider }) });

const progress = {
  current: null,
  done: 5,
  step: 5,
  total: 5,
  planned: null,
  environmentId: null,
  stages: [skill("self-codex", "self", "codex"), skill("agent-claude", "agent", "claude-code"), skill("self-bare", "self", "bare"), skill("agent-none", "agent"), skill("flow", "workflow")],
};

const logoOf = (el: Element) => el.querySelector<HTMLElement>("[data-provider-logo]");

describe("логотип провайдера в полосе этапов", () => {
  const rows = async () => {
    const app2 = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    const slot = renderSlot(app2.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" }, providers });
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    await waitFor(() => expect(slot.container.querySelectorAll("[data-progress-row]")).toHaveLength(5));
    return [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")];
  };

  it("этап самого агента — логотип провайдера треда вместо ромба, без квадрата", async () => {
    const row = (await rows())[0]!;
    expect(logoOf(row)?.getAttribute("data-provider-logo")).toBe(CODEX_LOGO);
    expect(logoOf(row)?.hasAttribute("data-framed")).toBe(false);
    expect(logoOf(row)?.getAttribute("aria-label")).toBe("Codex");
    expect(row.querySelector('[data-icon="Diamond"]')).toBeNull();
  });

  it("этап субагента — маленький логотип его провайдера в квадрате вместо робота", async () => {
    const row = (await rows())[1]!;
    const logo = logoOf(row)!;
    expect(logo.getAttribute("data-provider-logo")).toBe(CLAUDE_LOGO);
    expect(logo.hasAttribute("data-framed")).toBe(true);
    expect(row.querySelector('[data-icon="Bot"]')).toBeNull();
  });

  it("провайдер без логотипа или без провайдера — прежние ромб и робот; workflow не меняется", async () => {
    const [, , bare, none, flow] = await rows();
    expect(logoOf(bare!)).toBeNull();
    expect(bare!.querySelector('[data-icon="Diamond"]')).not.toBeNull();
    expect(none!.querySelector('[data-icon="Bot"]')).not.toBeNull();
    expect(flow!.querySelector('[data-icon="Workflow"]')).not.toBeNull();
  });
});

describe("логотип провайдера у исполнителя-агента в брифе и настройках", () => {
  it("бриф: у выбранного субагента — логотип его провайдера в квадрате вместо значка Claude", async () => {
    const brief = stagedBrief([report("plan", { recommended: true, executor: planner.id })]);
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) }, providers },
    );
    await slot.findByRole("group", { name: "Ответ на бриф" });
    const cell = slot.container.querySelector<HTMLElement>('[data-stage="plan"]')!;
    const logo = logoOf(cell)!;
    expect(logo.getAttribute("data-provider-logo")).toBe(CLAUDE_LOGO);
    expect(logo.hasAttribute("data-framed")).toBe(true);
    expect(slot.container.querySelector('[data-icon="Claude"]')).toBeNull();
  });

  it("настройки: у субагента этапа — логотип его провайдера в квадрате вместо значка Claude", async () => {
    const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [{ id: "plan", kind: "skill", skill: "plan", name: "План", executors: [planner] }] }], minButtonWidth: 170 };
    const slot = renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
      rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [planner] }) } as never,
      settings: { language: "Русский" },
      providers,
    });
    const row = await slot.findByRole("row", { name: "Этап 1" });
    await waitFor(() => expect(logoOf(row)).not.toBeNull());
    expect(logoOf(row)!.getAttribute("data-provider-logo")).toBe(CLAUDE_LOGO);
    expect(logoOf(row)!.hasAttribute("data-framed")).toBe(true);
    expect(row.querySelector('[data-icon="Claude"]')).toBeNull();
  });
});

describe("логотип провайдера в строке треда", () => {
  const mount = async (running: unknown[]) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ok: true, result: String(url).endsWith("runningThreads") ? running : [] }) })));
    const setStatus = vi.fn();
    await app.contentScripts.find((s) => s.id === "flow-awaiting")!.mount({ pluginId: "flow", generation: 1, signal: new AbortController().signal, experimental_setThreadRowStatus: setStatus } as PluginContentScriptContext);
    return setStatus;
  };
  const css = () => document.head.querySelector("style[data-flow-row-glyphs]")?.textContent ?? "";
  const rule = (label: string) => css().split("\n").find((line) => line.includes(`[aria-label="${label}"]{`)) ?? "";

  it("сам агент — логотип провайдера треда, субагент — логотип в квадрате; подпись называет провайдера, значок мерцает", async () => {
    const setStatus = await mount([
      { threadId: "thr_a", icon: "self", provider: { name: "Codex", logoUrl: CODEX_LOGO } },
      { threadId: "thr_b", icon: "agent", provider: { name: "Claude Code", logoUrl: CLAUDE_LOGO } },
    ]);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    const labelOf = (threadId: string) => (setStatus.mock.calls.find(([id]) => id === threadId)![1] as { label: string }).label;
    expect(labelOf("thr_a")).toContain("Codex");
    expect(labelOf("thr_b")).toContain("Claude Code");
    await vi.waitFor(() => expect(rule(labelOf("thr_a"))).toContain(`url("${CODEX_LOGO}")`));
    expect(rule(labelOf("thr_a"))).toMatch(/animation:/);
    expect(rule(labelOf("thr_b"))).toContain(`url("${CLAUDE_LOGO}")`);
    expect(rule(labelOf("thr_b"))).toContain("data:image/svg+xml");
  });
});
