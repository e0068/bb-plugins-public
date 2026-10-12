// @vitest-environment jsdom
// Строки списка flow перетаскиваются за ручку: на отпускании новый порядок пишется в настройки Flow, а первый flow
// остаётся flow по умолчанию. «Без flow» закреплена первой — её не взять и выше неё не поставить.
import type { ComponentType } from "react";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

const ROW = 28;

// В jsdom у строк нет размеров: строка flow получает высоту ROW по своему месту в списке.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = [...document.querySelectorAll("[data-flow-row]")].indexOf(this);
    const top = Math.max(0, at) * ROW;
    return { top, bottom: top + ROW, height: ROW, left: 0, right: 240, width: 240, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", [])] });
const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [flow("a", "Alpha"), flow("b", "Beta"), flow("c", "Gamma"), flow("d", "Delta")] };

const open = () =>
  renderSlot<PluginNavPanelProps, never>({ component: app.navPanels.find((p) => p.id === "flows")!.component as ComponentType<PluginNavPanelProps> }, { subPath: "a" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const saved = (slot: Slot): string[] | null => {
  const last = [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
  return last?.flows.map((f) => f.id) ?? null;
};
const nav = async (slot: Slot) => within(await slot.findByRole("navigation", { name: "Flow" }));
const rowOf = (slot: Slot, id: string) => slot.container.querySelector<HTMLElement>(`[data-flow-row="${id}"]`)!;

/** Берёт flow за ручку и ведёт указатель на высоту `y` — строки лежат по ROW пикселей одна под другой. */
const dragTo = async (slot: Slot, name: string, y: number) => {
  fireEvent.pointerDown(within(await slot.findByRole("navigation", { name: "Flow" })).getByRole("button", { name: `Перетащить flow ${name}` }));
  window.dispatchEvent(new MouseEvent("pointermove", { clientY: y }));
};
const release = () => window.dispatchEvent(new MouseEvent("pointerup"));

describe("перетаскивание строк списка flow", () => {
  it("первый flow, отпущенный ниже всех строк, становится последним", async () => {
    const slot = open();
    await dragTo(slot, "Alpha", 4 * ROW + 5);
    release();
    await waitFor(() => expect(saved(slot)).toEqual(["b", "c", "d", "a"]));
  });

  it("последний flow, отпущенный выше всех строк, становится первым — flow по умолчанию меняется вместе с порядком", async () => {
    const slot = open();
    await dragTo(slot, "Delta", -10);
    release();
    await waitFor(() => expect(saved(slot)).toEqual(["d", "a", "b", "c"]));
  });

  it("указатель между серединами строк ставит flow между ними", async () => {
    const slot = open();
    await dragTo(slot, "Alpha", 3 * ROW);
    release();
    await waitFor(() => expect(saved(slot)).toEqual(["b", "c", "a", "d"]));
  });

  it("пока flow несут, под указателем подсвечен стык: сверху у первой строки, снизу у последней", async () => {
    const slot = open();
    await dragTo(slot, "Delta", -10);
    await waitFor(() => expect(rowOf(slot, "a").dataset.drop).toBe("before"));
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 4 * ROW + 5 }));
    await waitFor(() => expect(rowOf(slot, "c").dataset.drop).toBe("after"));
    expect(rowOf(slot, "a").dataset.drop).toBeUndefined();
    release();
  });

  it("отпускание на своём месте ничего не сохраняет", async () => {
    const slot = open();
    await dragTo(slot, "Beta", ROW * 1.5 + 1);
    release();
    await nav(slot);
    expect(saved(slot)).toBeNull();
  });

  it("после отпускания подсветка стыка пропадает и новое движение не двигает строки", async () => {
    const slot = open();
    await dragTo(slot, "Alpha", 4 * ROW + 5);
    release();
    await waitFor(() => expect(saved(slot)).not.toBeNull());
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 0 }));
    expect(slot.container.querySelector("[data-drop]")).toBeNull();
  });

  it("у «Без flow» ручки нет, у каждого flow она есть", async () => {
    const slot = open();
    const list = await nav(slot);
    expect(list.queryByRole("button", { name: /^Перетащить flow Без flow/ })).toBeNull();
    for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) expect(list.getByRole("button", { name: `Перетащить flow ${name}` })).toBeTruthy();
  });

  it("«Без flow» и «Автоматически» — первые строки списка, перед flow владельца; ручки перетаскивания строками не считаются", async () => {
    const slot = open();
    const rows = (await nav(slot)).getAllByRole("button", { name: (name) => !name.startsWith("Перетащить flow") }).map((button) => button.textContent);
    expect(rows.slice(0, 4)).toEqual(["Без flow", "Автоматически", "Alpha", "Beta"]);
  });

  it("у «Автоматически» ручки нет", async () => {
    const slot = open();
    expect((await nav(slot)).queryByRole("button", { name: /^Перетащить flow Автоматически/ })).toBeNull();
  });

  it("«Без flow» не считается строкой flow: у неё нет метки строки перетаскивания", async () => {
    const slot = open();
    await nav(slot);
    expect([...slot.container.querySelectorAll("[data-flow-row]")].map((el) => (el as HTMLElement).dataset.flowRow)).toEqual(["a", "b", "c", "d"]);
  });
});
