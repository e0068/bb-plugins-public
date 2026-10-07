// @vitest-environment jsdom
// Список flow слева на странице Flow. Коллекция, поменявшаяся на сервере, — из папки или от агента, — видна
// открытой странице без перезагрузки.
import type { ComponentType } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, FlowSyncState, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const skill: WorkStage = { id: "work", kind: "skill", skill: "code", name: "Код", executors: [] };
const nested = (flowId: string): WorkStage => ({ id: `row-${flowId}`, kind: "skill", skill: "", name: "Вложенный", executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[] = [skill]) => ({ id, name, stages: [builtinStage("criteria", []), ...stages] });
const settings: FlowSettings = {
  version: 2,
  minButtonWidth: 170,
  flows: [flow("code", "Code", [skill, nested("review")]), flow("bug", "Bug"), flow("review", "Review", [skill, nested("lint")]), flow("lint", "Lint")],
};

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const openPage = (subPath = "", sync: FlowSyncState = { dir: "~/.claude/BB Flows", status: { kind: "synced", at: "2026-10-05T12:00:00.000Z" } }, current: () => FlowSettings = () => settings) =>
  renderSlot<PluginNavPanelProps, never>({ component: panel().component as ComponentType<PluginNavPanelProps> }, { subPath }, {
    rpc: {
      getFlowSettings: current,
      saveFlowSettings: (input: unknown) => input,
      getStageCatalog: () => ({ skills: [], executors: [] }),
      getFlowSync: () => sync,
      setFlowSyncDir: ({ dir }: { dir: string }) => ({ dir, status: dir === "" ? { kind: "off" } : { kind: "synced", at: "2026-10-05T12:01:00.000Z" } }),
    } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof openPage>;
const tree = (slot: Slot) => slot.findByRole("navigation", { name: "Flow" });

describe("дерево flow", () => {
  it("плюс даёт новому flow свободное имя, а не повтор", async () => {
    const slot = openPage("", undefined, () => ({ ...settings, flows: [...settings.flows, flow("new", "новый flow")] }));
    fireEvent.click(within(await tree(slot)).getByRole("button", { name: "Новый flow" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(true));
    const saved = [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")!.input as FlowSettings;
    expect(saved.flows.at(-1)!.name).toBe("Новый flow 2");
  });
});

describe("коллекция с сервера", () => {
  it("поменялась на сервере — открытая страница показывает новый flow без перезагрузки", async () => {
    let current = settings;
    const slot = openPage("", undefined, () => current);
    await tree(slot);
    current = { ...settings, flows: [...settings.flows, flow("shared", "С другого компа")] };
    await slot.emitRealtime("decisions:stage-settings", {});
    expect(await within(await tree(slot)).findByRole("button", { name: "С другого компа" })).toBeTruthy();
  });
});
