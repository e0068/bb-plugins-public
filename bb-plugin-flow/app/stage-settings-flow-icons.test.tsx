// @vitest-environment jsdom
// Таблица этапов и меню «Добавить этап»: группы меню разделены линиями, flow в меню и строка вложенного flow — с иконкой
// этого flow, а поле названия этапа держит иконку по центру своей высоты.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowSettings, flowSettingsRpcContract, StageTemplate, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [] });
const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Вложенный", executors: [], flowId });
/** Flow с иконкой: поле `icon` у flow появляется подзадачей data. */
const withIcon = (f: Flow, icon: string) => ({ ...f, icon }) as Flow;
const OUTER: Flow = { id: "outer", name: "Outer", stages: [stage("work"), ref("to-inner", "inner")] };
const INNER = withIcon({ id: "inner", name: "Inner", stages: [stage("check")] }, "Rocket");
const PLAIN: Flow = { id: "plain", name: "Plain", stages: [stage("lint")] };
const TEMPLATE: StageTemplate = { kind: "skill", skill: "review", name: "Ревью", executors: [] };

const open = (flows: Flow[], stageTemplates?: StageTemplate[]) => {
  const settings: FlowSettings = { version: 2, flows, minButtonWidth: 170, ...(stageTemplates === undefined ? {} : { stageTemplates }) };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: flows[0]!.id }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

type Slot = ReturnType<typeof open>;
const addStageMenu = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
  return slot.findByRole("menu", { name: "Добавить этап" });
};
const separators = (menu: HTMLElement) => [...menu.querySelectorAll('[role="separator"]')];
const classOf = (el: Element) => el.getAttribute("class")?.split(/\s+/) ?? [];

describe("меню «Добавить этап»", () => {
  it("между группами меню Добавить этап стоят разделители", async () => {
    const menu = await addStageMenu(open([OUTER, INNER, PLAIN], [TEMPLATE]));
    const groups = within(menu).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Виджеты", "Flow", "Шаблоны"]);
    expect(separators(menu)).toHaveLength(3);
    for (const group of groups) expect(group.previousElementSibling?.getAttribute("role"), `линия перед группой ${group.getAttribute("aria-label")}`).toBe("separator");
    expect(classOf(separators(menu)[0]!)).toEqual(expect.arrayContaining(["my-1", "h-px", "bg-border"]));
  });

  it("разделителя нет перед отсутствующей группой", async () => {
    const menu = await addStageMenu(open([{ id: "alone", name: "Alone", stages: [stage("work")] }]));
    const groups = within(menu).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["Виджеты"]);
    expect(separators(menu)).toHaveLength(1);
    expect(groups[0]!.previousElementSibling?.getAttribute("role")).toBe("separator");
  });

  it("пункт flow в меню показывает иконку flow", async () => {
    const menu = await addStageMenu(open([OUTER, INNER, PLAIN]));
    const group = within(within(menu).getByRole("group", { name: "Flow" }));
    const inner = group.getByRole("menuitem", { name: "Inner" });
    const plain = group.getByRole("menuitem", { name: "Plain" });
    expect(inner.querySelector('[data-icon="Rocket"]')).not.toBeNull();
    expect(plain.querySelector('[data-flow-mark="plain"]')).not.toBeNull();
  });
});

describe("таблица этапов", () => {
  it("строка вложенного flow показывает его иконку", async () => {
    const slot = open([OUTER, INNER, PLAIN]);
    const row = await slot.findByRole("row", { name: "Этап 2" });
    expect(row.querySelector('[data-icon="Rocket"]')).not.toBeNull();
  });

  it("иконка поля названия стоит по центру высоты поля", async () => {
    const slot = open([OUTER, INNER, PLAIN]);
    const input = await slot.findByRole("textbox", { name: "Название этапа 1" });
    expect(classOf(input)).toEqual(expect.arrayContaining(["max-md:pointer-coarse:h-9", "max-md:pointer-coarse:text-sm"]));
    const icon = input.parentElement!.querySelector(":scope > span")!;
    expect(icon.querySelector('button[aria-label^="Иконка этапа"]')).not.toBeNull();
    expect(classOf(icon)).toEqual(expect.arrayContaining(["absolute", "inset-y-0", "left-0.5", "flex", "items-center"]));
    expect(classOf(icon)).not.toContain("top-0.5");
  });
});
