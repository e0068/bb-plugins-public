// @vitest-environment jsdom
// Порядок шагов на странице читается по развёрнутым этапам, как на сервере: PR мог открыть вложенный flow.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Flow, FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalog: StageCatalog = { skills: [], executors: [] };
const chain = (id: string, name: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps: steps as never } });
const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], flowId });
const spec: WorkStage = { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] };

const OPENER: Flow = { id: "opener", name: "Opener", stages: [chain("pr", "PR", ["git.create-pr"])] };

const open = (outer: WorkStage[]) => {
  const initial: FlowSettings = { flows: [{ id: "outer", name: "Outer", stages: outer }, OPENER], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "outer" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

describe("порядок шагов и вложенный flow на странице", () => {
  it("бамп после строки с вложенным flow, открывающим PR, не блокирует сохранение", async () => {
    const slot = open([ref("nested", "opener"), chain("bump", "Бамп", ["files.bump-patch"]), spec]);
    fireEvent.click(await slot.findByRole("button", { name: "Удалить этап Spec" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(true));
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("пункт «Смёрджить PR» в меню шагов включён, когда PR открывает вложенный flow выше", async () => {
    const slot = open([ref("nested", "opener"), chain("flow-automation", "Слить", [])]);
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Исполнение этапа" }));
    const menu = within(await slot.findByRole("menu", { name: "Исполнение" }));
    expect((menu.getByRole("menuitem", { name: "Смёрджить PR" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("без открытого PR выше пункт по-прежнему выключен", async () => {
    const slot = open([chain("flow-automation", "Слить", [])]);
    const row = within(await slot.findByRole("row", { name: "Этап 1" }));
    fireEvent.click(row.getByRole("button", { name: "Исполнение этапа" }));
    const menu = within(await slot.findByRole("menu", { name: "Исполнение" }));
    expect((menu.getByRole("menuitem", { name: "Смёрджить PR" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
