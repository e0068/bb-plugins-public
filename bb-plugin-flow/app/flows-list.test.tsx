// @vitest-environment jsdom
// Список flow слева на странице Flow: плоский, каждый flow ровно один раз в порядке коллекции; у вложенного — число flow,
// в которых он стоит строкой «Flow», с их именами в подсказке. «История» в списке не стоит, «Новый flow» — кнопка во всю ширину.
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
const nested = (flowId: string): WorkStage => ({ id: `row-${flowId}`, kind: "skill", skill: "", name: "Вложенный", executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[] = [skill]) => ({ id, name, stages: [builtinStage("criteria", []), ...stages] });
const settings: FlowSettings = {
  version: 2,
  minButtonWidth: 170,
  flows: [flow("testing", "TESTING", [skill, nested("brief")]), flow("testing-2", "Testing 2", [nested("brief"), skill]), flow("brief", "Brief"), flow("solo", "Solo")],
};

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const openPage = (subPath = "") =>
  renderSlot<PluginNavPanelProps, never>({ component: panel().component as ComponentType<PluginNavPanelProps> }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof openPage>;
const list = async (slot: Slot) => within(await slot.findByRole("navigation", { name: "Flow" }));
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
/** Строка flow в списке: кнопка с его именем вместе с тем, что стоит рядом с ней. */
const rowsNamed = (nav: Awaited<ReturnType<typeof list>>, name: string) => nav.queryAllByRole("button").filter((b) => b.textContent?.includes(name));
const USED_IN = /^Используется в: /;

describe("плоский список flow", () => {
  it("flow, вложенный в два flow, показан один раз с числом 2 и подсказкой с их именами", async () => {
    const nav = await list(openPage("testing"));
    expect(rowsNamed(nav, "Brief")).toHaveLength(1);
    const count = nav.queryByTitle("Используется в: TESTING, Testing 2");
    expect(count, "число держателей с подсказкой").not.toBeNull();
    expect(count!.textContent).toBe("2");
    expect((count!.closest("button") ?? count!.parentElement)!.textContent).toContain("Brief");
  });

  it("flow без вложений идёт без числа", async () => {
    const nav = await list(openPage("testing"));
    expect(nav.queryAllByTitle(USED_IN).map((count) => count.textContent)).toEqual(["2"]);
    for (const name of ["TESTING", "Testing 2", "Solo"]) {
      const rows = rowsNamed(nav, name);
      expect(rows.map((row) => row.textContent)).toEqual([name]);
    }
  });

  it("в списке нет строки История", async () => {
    const nav = await list(openPage("testing"));
    expect(nav.queryByRole("button", { name: "История" })).toBeNull();
    expect(nav.queryByText("История")).toBeNull();
  });
});

describe("кнопка «Новый flow»", () => {
  it("кнопка Новый flow подписана и создаёт flow, открывая его", async () => {
    const slot = openPage("testing");
    await list(slot);
    const add = slot.getByRole("button", { name: "Новый flow" });
    expect(add.textContent).toBe("Новый flow");
    expect(add.className.split(/\s+/)).toContain("w-full");
    expect(add.querySelector('[data-icon="Plus"]')).not.toBeNull();
    fireEvent.click(add);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(5));
    const created = lastSaved(slot)!.flows[4]!;
    expect(created.name).toBe("Новый flow");
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: created.id } });
  });
});
