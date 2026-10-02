// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [
    {
      id: "default",
      name: "Default",
      stages: [
        { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
        { id: "task", kind: "skill", skill: "task-flow", name: "Task", executors: [] },
        { id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [{ id: "agent:reviewer", kind: "agent", name: "reviewer", provider: "claude-code" }] },
      ],
    },
  ],
  minButtonWidth: 170,
};

const catalog: StageCatalog = {
  skills: [
    { name: "figma:figma-use", description: "Figma", origin: { kind: "plugin", plugin: "figma", provider: "claude-code" } },
    { name: "flow-demo", origin: { kind: "plugin", plugin: "flow" } },
    { name: "release-notes", origin: { kind: "project" } },
    { name: "spec", origin: { kind: "own" } },
  ],
  executors: [
    { id: "agent:reviewer", kind: "agent", name: "reviewer", provider: "claude-code", origin: { kind: "own" } },
    { id: "agent:scout", kind: "agent", name: "scout", provider: "claude-code", origin: { kind: "project", project: "bb-plugins" } },
    { id: "agent:cm:critic", kind: "agent", name: "cm:critic", provider: "claude-code", origin: { kind: "plugin", plugin: "cm" } },
    { id: "agent:codex/reviewer", kind: "agent", name: "reviewer", provider: "codex" },
    { id: "workflow:DEV1", kind: "workflow", name: "DEV1" },
  ],
};

const open = (withCatalog: StageCatalog = catalog) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => withCatalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));
const skillField = async (slot: Slot, n: number) => (await row(slot, n)).getByRole("combobox", { name: `Навык этапа ${n}` }) as HTMLInputElement;

describe("поле навыка без файла", () => {
  it("навыка нет в каталоге — поле пустое, без имени и без кнопок файла", async () => {
    const slot = open();
    const field = await skillField(slot, 2);
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("");
    expect((await row(slot, 2)).queryByRole("button", { name: /Открыть навык|Показать навык/ })).toBeNull();
  });

  it("навык есть в каталоге — имя в поле и кнопки файла на месте", async () => {
    const slot = open();
    expect((await skillField(slot, 1)).value).toBe("spec");
    expect((await row(slot, 1)).getByRole("button", { name: "Открыть навык spec" })).toBeTruthy();
  });

  it("каталог не прочитан — поля показывают имена как есть", async () => {
    const slot = open({ skills: [], executors: [] });
    expect((await skillField(slot, 2)).value).toBe("task-flow");
  });
});

describe("список навыков по группам", () => {
  it("группы с заголовками по источнику, в строке плагина провайдера имя без префикса", async () => {
    const slot = open();
    fireEvent.focus(await skillField(slot, 2));
    const list = within(slot.getByRole("listbox", { name: "Навыки" }));
    expect(list.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Мои навыки", "Навыки проекта", "Плагин bb · flow", "Claude Code · figma"]);
    const figma = within(list.getByRole("group", { name: "Claude Code · figma" }));
    expect(figma.getByRole("option").textContent).toContain("figma-use");
    expect(figma.getByRole("option").textContent).not.toContain("figma:");
  });

  it("выбор навыка плагина провайдера сохраняет полное имя", async () => {
    const slot = open();
    fireEvent.focus(await skillField(slot, 2));
    fireEvent.click(slot.getByRole("option", { name: /figma-use/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[1]).toMatchObject({ skill: "figma:figma-use" }));
  });
});

