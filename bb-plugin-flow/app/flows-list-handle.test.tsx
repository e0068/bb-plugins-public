// @vitest-environment jsdom
// Ручка перетаскивания стоит в своей полосе слева от значка flow и на него не заходит: значок виден всегда — без наведения,
// при наведении, при фокусе с клавиатуры и пока строку тащат. Полоса есть у всех строк списка, поэтому значки стоят в одну линию.
import type { ComponentType } from "react";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "a", name: "Alpha", stages: [builtinStage("criteria", [])] }] };

const open = () =>
  renderSlot<PluginNavPanelProps, never>({ component: app.navPanels.find((p) => p.id === "flows")!.component as ComponentType<PluginNavPanelProps> }, { subPath: "a" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });

const classesOf = (element: Element): string[] => (element.getAttribute("class") ?? "").split(/\s+/);
/** Число единиц шага Tailwind (`pl-7` → 7, `left-1.5` → 1.5) из класса с префиксом, `null` — класса нет. */
const stepsOf = (element: Element, prefix: string): number | null => {
  const found = classesOf(element).find((name) => new RegExp(`^${prefix}-\\d+(\\.5)?$`).test(name));
  return found === undefined ? null : Number(found.slice(prefix.length + 1));
};

const parts = async (slot: ReturnType<typeof open>) => {
  const nav = within(await slot.findByRole("navigation", { name: "Flow" }));
  const row = nav.getByRole("button", { name: "Alpha" });
  return { nav, row, glyph: row.querySelector("svg")!, handle: nav.getByRole("button", { name: "Перетащить flow Alpha" }) };
};

describe("ручка перетаскивания в строке flow", () => {
  it("значок не прячется ни при наведении, ни при фокусе с клавиатуры", async () => {
    const { glyph } = await parts(open());
    expect(classesOf(glyph).filter((name) => /opacity-0$/.test(name))).toEqual([]);
  });

  it("пока строку тащат, значок остаётся виден", async () => {
    const slot = open();
    const { glyph, handle } = await parts(slot);
    fireEvent.pointerDown(handle);
    expect(classesOf(glyph).filter((name) => /opacity-0$/.test(name))).toEqual([]);
  });

  it("ручка целиком умещается в полосе слева от значка", async () => {
    const { row, handle } = await parts(open());
    const lane = stepsOf(row, "pl");
    const left = stepsOf(handle, "left");
    const width = stepsOf(handle, "size");
    expect(lane).not.toBeNull();
    expect(left).not.toBeNull();
    expect(width).not.toBeNull();
    expect(left! + width!).toBeLessThanOrEqual(lane!);
  });

  it("у «Без flow» и «Автоматически» та же полоса, значки стоят в одну линию", async () => {
    const { nav, row } = await parts(open());
    for (const name of ["Без flow", "Автоматически"]) expect(stepsOf(nav.getByRole("button", { name }), "pl")).toBe(stepsOf(row, "pl"));
  });

  it("без наведения и фокуса ручки нет, при наведении и фокусе — есть", async () => {
    const { handle } = await parts(open());
    expect(classesOf(handle)).toContain("opacity-0");
    expect(classesOf(handle)).toContain("group-hover:opacity-100");
    expect(classesOf(handle).some((name) => name.includes("focus-visible") && name.endsWith(":opacity-100"))).toBe(true);
  });
});
