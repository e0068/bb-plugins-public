// @vitest-environment jsdom
// Страница Flow на узкой панели — два уровня: без выбранного flow виден только список, с выбранным — только он и «Назад»
// слева сверху. На широкой видны обе колонки. У flow выбирается иконка, подпись ограничений отступает и бледнеет.
import type { ComponentType } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const skill: WorkStage = { id: "work", kind: "skill", skill: "code", name: "Код", executors: [] };
const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", []), skill] });
const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [flow("default", "Default"), flow("quick", "Quick")] };

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const openPage = (subPath: string) =>
  renderSlot<PluginNavPanelProps, never>({ component: panel().component as ComponentType<PluginNavPanelProps> }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof openPage>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const NARROW_HIDDEN = "@max-3xl:hidden";

/** Две колонки страницы: та, где список flow, и та, где поле названия flow, — дети их ближайшего общего предка. */
const columns = async (slot: Slot) => {
  const list = await slot.findByRole("navigation", { name: "Flow" });
  const name = await slot.findByRole("textbox", { name: "Название flow" });
  const columnOf = (node: HTMLElement, parent: HTMLElement): HTMLElement => (node.parentElement === parent ? node : columnOf(node.parentElement!, parent));
  const common = (node: HTMLElement): HTMLElement => (node.contains(name) ? node : common(node.parentElement!));
  const parent = common(list);
  return { list: columnOf(list, parent), right: columnOf(name, parent) };
};
const classOf = (el: HTMLElement) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("два уровня на узкой панели", () => {
  it("без выбранного flow правая колонка скрыта на узкой ширине", async () => {
    const { list, right } = await columns(openPage(""));
    expect(classOf(right)).toContain(NARROW_HIDDEN);
    expect(classOf(list)).not.toContain(NARROW_HIDDEN);
  });

  it("с выбранным flow список скрыт на узкой ширине", async () => {
    const { list, right } = await columns(openPage("quick"));
    expect(classOf(list)).toContain(NARROW_HIDDEN);
    expect(classOf(right)).not.toContain(NARROW_HIDDEN);
  });

  it("Назад со второго уровня открывает список", async () => {
    const slot = openPage("quick");
    await columns(slot);
    const back = slot.queryByRole("button", { name: "Назад" });
    expect(back, "кнопка «Назад» над правой колонкой").not.toBeNull();
    expect(classOf(back!)).toContain("@3xl:hidden");
    expect(back!.querySelector('[data-icon="ChevronLeft"]')).not.toBeNull();
    fireEvent.click(back!);
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "" } });
  });
});

describe("иконка flow и подпись ограничений", () => {
  it("выбор иконки сохраняет её flow", async () => {
    const slot = openPage("quick");
    await columns(slot);
    const picker = slot.queryByRole("button", { name: "Иконка этапа Quick" });
    expect(picker, "выбор иконки слева от названия flow").not.toBeNull();
    fireEvent.click(picker!);
    fireEvent.click(within(slot.getByRole("listbox")).getByRole("option", { name: "Rocket" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows.find((f) => f.id === "quick")).toMatchObject({ icon: "Rocket" }));
    expect(lastSaved(slot)!.flows.find((f) => f.id === "default")).not.toHaveProperty("icon");
  });

  it("подпись ограничений третьестепенная", async () => {
    const slot = openPage("quick");
    const hint = await slot.findByText(/^Агенту треда грузятся только навыки и агенты/);
    expect(classOf(hint)).toContain("text-subtle-foreground");
    expect(classOf(hint)).not.toContain("text-muted-foreground");
    expect(classOf(hint.parentElement!)).toContain("gap-2");
  });
});
