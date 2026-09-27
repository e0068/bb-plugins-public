// @vitest-environment jsdom
// Вкладка «История» на странице Flow: первой в ленте шапки, список завершённых прогонов по адресу панели `history`.
import type { ComponentType } from "react";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", [])] });
const settings: FlowSettings = { version: 2, flows: [flow("default", "Default"), flow("quick", "Quick")], minButtonWidth: 170 };

const summary = (startedAt: string, finishedAt: string) => ({
  startedAt,
  finishedAt,
  minutes: 42,
  wallMinutes: 60,
  idleMinutes: 18,
  cost: 12.5,
  stages: 2,
  skipped: 0,
  executors: [{ id: "self", kind: "self", name: "self", stages: 2, cost: 12.5 }],
});

const entry = (patch: Record<string, unknown>) => ({
  briefId: "dec_a",
  threadId: "thr_a",
  title: "Тред А",
  exists: true,
  done: 2,
  total: 2,
  planned: null,
  environmentId: null,
  flowName: "Разработка",
  summary: summary("2026-09-20T10:00:00.000Z", "2026-09-20T11:00:00.000Z"),
  stages: [
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [{ label: "task.md", target: "docs/tasks/task.md" }], minutes: 30, cost: 10, number: 1 },
    { id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "done", results: [], minutes: 12, cost: 2.5, number: 2 },
  ],
  ...patch,
});

const openHistory = (history: unknown[]) =>
  renderSlot<PluginNavPanelProps, never>({ component: app.navPanels.find((p) => p.id === "flows")!.component }, { subPath: "history" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRunHistory: () => history } as never,
    settings: { language: "Русский" },
  });

const flowCell = async (slot: ReturnType<typeof openHistory>) => {
  await waitFor(() => expect(slot.container.querySelector("[data-history-cell='flow']")).not.toBeNull());
  return slot.container.querySelector<HTMLElement>("[data-history-cell='flow']")!;
};

describe("название flow в строке истории", () => {
  it("живой flow — кнопка, которая открывает страницу flow и не раскрывает строку", async () => {
    const slot = openHistory([entry({ flowId: "quick", flowName: "Quick" })]);
    fireEvent.click(within(await flowCell(slot)).getByRole("button", { name: "Quick" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "quick" } });
    expect(slot.container.querySelector("[aria-expanded='true']")).toBeNull();
  });

  it("без id flow — просто текст, без кнопки", async () => {
    const cell = await flowCell(openHistory([entry({ flowName: "Разработка" })]));
    expect(cell.textContent).toBe("Разработка");
    expect(within(cell).queryByRole("button")).toBeNull();
  });
});
