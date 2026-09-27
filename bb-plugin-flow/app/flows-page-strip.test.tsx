// @vitest-environment jsdom
// Лента flow — первая строка тела страницы, а не шапка панели: в титул-баре
// хоста она не листалась вбок. Страницу листает её корень целиком — одна
// прокрутка на всё, без рамок со своим скроллом внутри.
import type { ComponentType } from "react";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage, stageKindOf } from "../lib/stage-constants";
import type { DecisionBrief, FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", []), { id: "implement", kind: "skill" as const, skill: "code", name: "Код", executors: [] }] });
const settings: FlowSettings = { version: 2, flows: [flow("default", "Default"), flow("quick", "Quick")], minButtonWidth: 170 };

const summary = {
  startedAt: "2026-09-20T10:00:00.000Z",
  finishedAt: "2026-09-20T11:00:00.000Z",
  minutes: 42,
  wallMinutes: 60,
  idleMinutes: 18,
  cost: 12.5,
  stages: 2,
  skipped: 0,
  executors: [{ id: "self", kind: "self", name: "self", stages: 2, cost: 12.5 }],
};

const stages = [
  { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [{ label: "task.md", target: "docs/tasks/task.md" }], minutes: 30, cost: 10, number: 1 },
  { id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "done", results: [], minutes: 12, cost: 2.5, number: 2 },
];

const run = { briefId: "dec_a", threadId: "thr_a", title: "Тред А", exists: true, done: 2, total: 2, planned: null, environmentId: null, flowName: "Разработка", summary, stages };

const panel = () => app.navPanels.find((p) => p.id === "flows")!;

const openPage = (subPath = "") =>
  renderSlot<PluginNavPanelProps, never>({ component: panel().component as ComponentType<PluginNavPanelProps> }, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRunHistory: () => [run] } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof openPage>;
const strip = (slot: Slot) => slot.findByRole("navigation", { name: "Flow" });
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

/** Всё, что листается по вертикали: лента листается только вбок и сюда не входит. */
const verticalScrollers = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>("*")].filter((el) => /(^|\s)(max-h-\S+|overflow-(auto|scroll|y-auto|y-scroll))(\s|$)/.test(el.getAttribute("class") ?? ""));

describe("лента flow в теле страницы", () => {
  it("шапки панели у Flow больше нет — титул-бар хоста остаётся пустым", () => {
    expect(panel().headerContent).toBeUndefined();
  });

  it("страница flow начинается лентой, выбранный flow помечен текущим", async () => {
    const tabs = within(await strip(openPage("quick")));
    expect(tabs.getByRole("button", { name: "Quick" }).getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });

  it("на истории лента тоже есть: первой стоит «История», и она текущая", async () => {
    const tabs = within(await strip(openPage("history")));
    const buttons = tabs.getAllByRole("button");
    expect(buttons[0]!.textContent).toContain("История");
    expect(buttons[0]!.getAttribute("aria-current")).toBe("page");
    expect(tabs.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });

  it("выбор flow и истории — адрес панели", async () => {
    const slot = openPage();
    const tabs = within(await strip(slot));
    fireEvent.click(tabs.getByRole("button", { name: "Quick" }));
    fireEvent.click(tabs.getByRole("button", { name: "История" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "quick" } });
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "history" } });
  });

  it("плюс в конце ленты создаёт flow с Вопросами, Критериями и Выбором этапов впереди и открывает его", async () => {
    const slot = openPage();
    const add = within(await strip(slot)).getByRole("button", { name: "Новый flow" });
    expect(add.textContent).toBe("");
    fireEvent.click(add);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(3));
    const created = lastSaved(slot)!.flows[2]!;
    expect(created.stages.slice(0, 3).map(stageKindOf)).toEqual(["questions", "criteria", "select"]);
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: created.id } });
  });

  it("созданный flow страница открывает из той же коллекции, не перечитывая сервер", async () => {
    const slot = openPage();
    fireEvent.click(within(await strip(slot)).getByRole("button", { name: "Новый flow" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toHaveLength(3));
    const Page = panel().component;
    slot.lifecycle.rerender(<Page subPath={lastSaved(slot)!.flows[2]!.id} />);
    await waitFor(() => expect((slot.getByRole("textbox", { name: "Название flow" }) as HTMLInputElement).value).toBe("Новый flow"));
    expect(slot.rpcCalls.filter((c) => c.method === "getFlowSettings")).toHaveLength(1);
  });

  it("удаления flow в ленте нет — оно внизу страницы", async () => {
    expect(within(await strip(openPage())).queryByRole("button", { name: /Удалить flow/ })).toBeNull();
  });

  it("не помещается — лента листается вбок сама, вкладки не сжимаются", async () => {
    const nav = await strip(openPage());
    expect(nav.className).toContain("overflow-x-auto");
    within(nav).getAllByRole("button").forEach((tab) => expect(tab.className).toContain("shrink-0"));
  });
});

describe("одна прокрутка на страницу", () => {
  it("страницу flow листает один корень, и лента внутри него", async () => {
    const slot = openPage("quick");
    const nav = await strip(slot);
    await slot.findByRole("textbox", { name: "Название flow" });
    const scrollers = verticalScrollers(slot.container);
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]!.contains(nav)).toBe(true);
  });

  it("историю с раскрытым прогоном листает тот же один корень: этапы прогона без своей прокрутки", async () => {
    const slot = openPage("history");
    const nav = await strip(slot);
    await waitFor(() => expect(slot.container.querySelector("[data-run-history-row]")).not.toBeNull());
    fireEvent.click(slot.getByRole("button", { name: /Раскрыть итог прогона/ }));
    await waitFor(() => expect(slot.container.querySelectorAll("[data-progress-row]")).toHaveLength(2));
    const scrollers = verticalScrollers(slot.container);
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0]!.contains(nav)).toBe(true);
  });
});

describe("итог прогона в ленте треда", () => {
  const brief: DecisionBrief = {
    id: "dec_demo",
    threadId: "thr_1",
    title: "Демонстрация",
    createdAt: "2026-09-19T10:00:00.000Z",
    kind: "brief",
    questions: [],
    outcome: { stage: "demo", final: true, done: ["Итог в ленте"], pending: [], results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }] },
    stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
  };

  it("этапы развёрнутой полосы по-прежнему листаются в своей рамке", async () => {
    const slot = renderSlot<PluginMessageDirectiveProps, never>(
      app.messageDirectives[0]!,
      { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      {
        rpc: {
          getBrief: () => ({ kind: "found", brief, answer: null }),
          getDispatchPlace: () => ({ place: "here" }),
          listProjects: () => ({ kind: "found" as const, projects: [] }),
          getRunSummary: () => ({ ...run, threadId: "thr_1" }),
        } as never,
        settings: { language: "Русский" },
      },
    );
    await waitFor(() => expect(slot.container.querySelector("[data-run-summary]")).not.toBeNull());
    const found = slot.container.querySelector<HTMLElement>("[data-run-summary]")!;
    fireEvent.click(within(found).getByRole("button", { name: /Прогресс flow/ }));
    await waitFor(() => expect(found.querySelectorAll("[data-progress-row]")).toHaveLength(2));
    expect(verticalScrollers(found)).toHaveLength(1);
  });
});
