// @vitest-environment jsdom
// Удаление flow — внизу страницы выбранного flow и только после подтверждения.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", []), { id: "implement", kind: "skill" as const, skill: "code", name: "Код", executors: [] }] });

const settings: FlowSettings = { version: 2, flows: [flow("default", "Default"), flow("quick", "Quick")], minButtonWidth: 170 };
const single: FlowSettings = { version: 2, flows: [flow("default", "Default")], minButtonWidth: 170 };

const catalog: StageCatalog = { skills: [{ name: "plan" }], executors: [] };

const open = (options: { subPath?: string; initial?: FlowSettings } = {}) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: options.subPath ?? "" }, {
    rpc: { getFlowSettings: () => options.initial ?? settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("удаление flow внизу страницы", () => {
  it("первый клик только спрашивает, второй удаляет", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Удалить flow Default" }));
    expect(lastSaved(slot)).toBeUndefined();
    fireEvent.click(slot.getByRole("button", { name: "Удалить" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows.map((f) => f.id)).toEqual(["quick"]));
  });

  it("отмена возвращает кнопку и ничего не удаляет", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Удалить flow Default" }));
    fireEvent.click(slot.getByRole("button", { name: "Отмена" }));
    expect(slot.getByRole("button", { name: "Удалить flow Default" })).toBeTruthy();
    expect(lastSaved(slot)).toBeUndefined();
  });

  it("у единственного flow удаления нет", async () => {
    const slot = open({ initial: single });
    await slot.findByRole("textbox", { name: "Название flow" });
    expect(slot.queryByRole("button", { name: /Удалить flow/ })).toBeNull();
  });
});
