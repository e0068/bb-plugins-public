// @vitest-environment jsdom
// Тред провайдера в меню исполнения этапа на странице Flow: «Тред Codex» в сегменте «Субагент» и ставится на этап (BBPL-965).
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { threadExecutor } from "../core/provider-threads";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: FlowSettings = { flows: [{ id: "default", name: "Default", stages: [{ id: "practice", kind: "skill", skill: "code-standards-fp", name: "Execution", executors: [] }] }], minButtonWidth: 170 };
const catalog: StageCatalog = {
  skills: [{ name: "code-standards-fp" }],
  executors: [{ id: "agent:codex/coder", kind: "agent", name: "coder", provider: "codex" }, threadExecutor({ id: "codex", displayName: "Codex" })],
};

const open = () => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

describe("тред провайдера в меню исполнения", () => {
  it("«Тред Codex» — в группе «Плагин · bb» сегмента «Субагент», клик ставит thread:codex на этап", async () => {
    const slot = open();
    fireEvent.click(within(await slot.findByRole("row", { name: "Этап 1" })).getByRole("button", { name: "Исполнение этапа" }));
    const menu = within(await slot.findByRole("menu", { name: "Исполнение" }));
    const item = within(menu.getByRole("group", { name: "Плагин · bb" })).getByRole("menuitemcheckbox", { name: /Тред Codex/ });
    fireEvent.click(item);
    await vi.waitFor(() => {
      const saved = [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
      expect(saved?.flows[0]?.stages[0]?.executors.map((e) => e.id)).toEqual(["thread:codex"]);
    });
  });
});
