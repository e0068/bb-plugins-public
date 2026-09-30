// @vitest-environment jsdom
// Выбор flow агентом переехал в кнопку композера: в настройках плагина его секции нет.
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

describe("настройки Flow без выбора flow агентом", () => {
  it("секции «Выбор flow агентом» нет, секция кнопок этапов на месте", () => {
    const ids = app.settingsSections.map((s) => s.id);
    expect(ids).toContain("stage-buttons");
    expect(ids).not.toContain("agent-flow-choice");
  });

  it("Flow — пункт левого меню, а таблицы этапов в секции кнопок нет", async () => {
    expect(app.navPanels.map((p) => [p.id, p.title, p.path])).toEqual([["flows", "Flow", "flows"]]);
    const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };
    const slot = renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === "stage-buttons")!, {}, {
      rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
      settings: { language: "Русский" },
    });
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "getFlowSettings")).toBe(true));
    expect(slot.queryByRole("row", { name: "Этап 1" })).toBeNull();
  });
});
