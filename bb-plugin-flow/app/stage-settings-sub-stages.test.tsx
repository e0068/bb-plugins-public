// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

const ROW = 40;

// В jsdom у строк нет размеров: строка таблицы этапов получает высоту ROW по своему месту.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = [...document.querySelectorAll("[data-stage-row]")].indexOf(this);
    const top = Math.max(0, at) * ROW;
    return { top, bottom: top + ROW, height: ROW, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const demo = (patch: Partial<WorkStage> = {}): WorkStage => stage("demo", { kind: "demo", skill: "", name: "demo", ...patch });
const catalog: StageCatalog = { skills: [], executors: [] };

const open = (stages: WorkStage[]) => {
  const settings: FlowSettings = { flows: [{ id: "plugin", name: "BB Plugin", stages }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

type Slot = ReturnType<typeof open>;

const saved = (slot: Slot): WorkStage[] | null => {
  const calls = slot.rpcCalls.filter((c) => c.method === "saveFlowSettings");
  const last = calls[calls.length - 1]?.input as FlowSettings | undefined;
  return last?.flows[0]?.stages ?? null;
};
const linked = (stages: readonly WorkStage[] | null) => stages?.map((s) => (s.parent === undefined ? s.id : `${s.id}<${s.parent}`)) ?? null;

/** Тянет этап за номер и ведёт указатель в четверть `zone` строки `row` (с нуля). */
const dragTo = async (slot: Slot, name: string, row: number, zone: 1 | 2 | 3 | 4) => {
  fireEvent.pointerDown(await slot.findByRole("button", { name: `Перетащить этап ${name}` }));
  window.dispatchEvent(new MouseEvent("pointermove", { clientY: row * ROW + (zone - 0.5) * (ROW / 4) }));
};
const release = () => window.dispatchEvent(new MouseEvent("pointerup"));

const LINKED = [stage("ship"), stage("preview", { parent: "demo" }), demo(), stage("restore", { parent: "demo" }), stage("merge")];
const FLAT = [stage("ship"), stage("preview"), demo(), stage("restore"), stage("merge")];

describe("под-этапы в таблице этапов", () => {
  it("охват Выбора и Демонстрации — по номерам верхнего уровня", async () => {
    const slot = open([stage("select", { kind: "select", skill: "", name: "select" }), ...LINKED]);
    expect((await slot.findByRole("row", { name: "Этап 1" })).textContent).toContain("выбирает этапы 2–4");
    expect(slot.getByRole("row", { name: "Этап 4" }).textContent).toContain("показывает этапы 1–2");
  });

  it("вторая четверть Демонстрации делает Preview её под-этапом до неё", async () => {
    const slot = open(FLAT);
    await dragTo(slot, "preview", 2, 2);
    const target = slot.getByRole("row", { name: "Этап 3" });
    await waitFor(() => expect(target.dataset.drop).toBe("whole"));
    expect(target.textContent).toContain("под-этап «demo» — до");
    release();
    await waitFor(() => expect(linked(saved(slot))).toEqual(["ship", "preview<demo", "demo", "restore", "merge"]));
  });

  it("верхняя четверть ставит этап над строкой и подсвечивает стык", async () => {
    const slot = open(FLAT);
    await dragTo(slot, "merge", 0, 1);
    await waitFor(() => expect(slot.getByRole("row", { name: "Этап 1" }).dataset.drop).toBe("top"));
    release();
    await waitFor(() => expect(linked(saved(slot))).toEqual(["merge", "ship", "preview", "demo", "restore"]));
  });

  it("удалённый владелец оставляет под-этапы этапами с номерами", async () => {
    const slot = open(LINKED);
    fireEvent.click(await slot.findByRole("button", { name: "Удалить этап demo" }));
    await waitFor(() => expect(linked(saved(slot))).toEqual(["ship", "preview", "restore", "merge"]));
  });
});
