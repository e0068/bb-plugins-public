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

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const mount = (component: ComponentType<PluginNavPanelProps>, subPath: string, history: unknown[] = []) =>
  renderSlot<PluginNavPanelProps, never>({ component }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRunHistory: () => history } as never,
    settings: { language: "Русский" },
  });

const openHeader = (subPath = "") => mount(panel().headerContent!, subPath);
const openHistory = (history: unknown[]) => mount(panel().component, "history", history);

const rows = async (slot: ReturnType<typeof openHistory>) => {
  await waitFor(() => expect(slot.container.querySelectorAll("[data-run-history-row]").length).toBeGreaterThan(0));
  return [...slot.container.querySelectorAll<HTMLElement>("[data-run-history-row]")];
};

describe("вкладка «История» в шапке", () => {
  it("стоит первой в ленте, перед flow", async () => {
    const nav = await openHeader().findByRole("navigation", { name: "Flow" });
    const tabs = within(nav).getAllByRole("button");
    expect(tabs[0]!.textContent).toContain("История");
    expect(tabs[1]!.textContent).toContain("Default");
  });

  it("открывает историю адресом панели, как вкладки flow", async () => {
    const slot = openHeader();
    fireEvent.click(within(await slot.findByRole("navigation", { name: "Flow" })).getByRole("button", { name: "История" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "history" } });
  });

  it("на истории текущая вкладка — она, а не flow по умолчанию", async () => {
    const tabs = within(await openHeader("history").findByRole("navigation", { name: "Flow" }));
    expect(tabs.getByRole("button", { name: "История" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });

  it("лента заполняет шапку по ширине и листается вбок, вкладки не сжимаются", async () => {
    const nav = await openHeader().findByRole("navigation", { name: "Flow" });
    expect(nav.className).toContain("flex-1");
    expect(nav.className).toContain("overflow-x-auto");
    within(nav).getAllByRole("button").forEach((tab) => expect(tab.className).toContain("shrink-0"));
  });
});

describe("страница истории", () => {
  it("строка — тред, flow, дата, минуты, деньги и этапы «сделано/всего», в порядке сервера", async () => {
    const slot = openHistory([entry({ briefId: "dec_b", title: "Тред Б" }), entry({})]);
    const [first, second] = await rows(slot);
    expect(first!.textContent).toContain("Тред Б");
    expect(second!.textContent).toContain("Тред А");
    expect(first!.textContent).toContain("Разработка");
    expect(first!.textContent).toContain("20 сентября");
    expect(first!.textContent).toContain("42 м");
    expect(first!.textContent).toContain("$12.5");
    expect(first!.textContent).toContain("2/2");
  });

  it("строка раскрывается в тот же итог, что в ленте, — этапы со ссылками", async () => {
    const slot = openHistory([entry({})]);
    const [row] = await rows(slot);
    expect(row!.querySelector("[data-run-summary-body]")).toBeNull();
    fireEvent.click(within(row!).getByRole("button", { name: /Раскрыть/ }));
    const body = await waitFor(() => row!.querySelector<HTMLElement>("[data-run-summary-body]")!);
    fireEvent.click(within(body).getByRole("button", { name: /Прогресс flow/ }));
    await waitFor(() => expect(body.querySelectorAll("[data-progress-row]")).toHaveLength(2));
    expect(body.textContent).toContain("task.md");
  });

  it("название треда открывает тред", async () => {
    const slot = openHistory([entry({})]);
    const [row] = await rows(slot);
    fireEvent.click(within(row!).getByRole("button", { name: "Тред А" }));
    expect(slot.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread", threadId: "thr_a" }));
  });

  it("у удалённого треда строка остаётся, но без ссылки", async () => {
    const slot = openHistory([entry({ title: null, exists: false })]);
    const [row] = await rows(slot);
    expect(row!.textContent).toContain("Тред удалён");
    expect(within(row!).queryByRole("button", { name: "Тред удалён" })).toBeNull();
  });

  it("пустая история говорит об этом строкой", async () => {
    const slot = openHistory([]);
    await waitFor(() => expect(slot.container.textContent).toContain("Завершённых прогонов пока нет"));
  });
});
