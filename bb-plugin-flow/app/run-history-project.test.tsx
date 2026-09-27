// @vitest-environment jsdom
// История прогонов: проект треда своей колонкой и короткие моменты начала и конца.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

/** Местное время: колонки показывают день и час владельца. */
const at = (year: number, month: number, day: number, hours: number, minutes: number) => new Date(year, month - 1, day, hours, minutes).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 26, 19, 5));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [builtinStage("criteria", [])] }], minButtonWidth: 170 };

const entry = (patch: { briefId: string; project?: string | null; startedAt?: string; finishedAt?: string }) => ({
  briefId: patch.briefId,
  threadId: `thr_${patch.briefId}`,
  title: `Тред ${patch.briefId}`,
  exists: true,
  project: patch.project === undefined ? "bb-plugins" : patch.project,
  done: 2,
  total: 2,
  planned: null,
  environmentId: null,
  flowName: "Разработка",
  summary: {
    startedAt: patch.startedAt ?? at(2026, 9, 26, 17, 41),
    finishedAt: patch.finishedAt ?? at(2026, 9, 26, 18, 53),
    minutes: 42,
    wallMinutes: 60,
    idleMinutes: 18,
    cost: 12.5,
    stages: 2,
    skipped: 0,
    executors: [{ id: "self", kind: "self", name: "self", stages: 2, cost: 12.5 }],
  },
  stages: [{ id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [], minutes: 42, cost: 12.5, number: 1 }],
});

const openHistory = (history: unknown[]) =>
  renderSlot<PluginNavPanelProps, never>({ component: app.navPanels.find((p) => p.id === "flows")!.component }, { subPath: "history" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRunHistory: () => history } as never,
    settings: { language: "Русский" },
  });

const rows = async (slot: ReturnType<typeof openHistory>) => {
  await waitFor(() => expect(slot.container.querySelectorAll("[data-run-history-row]").length).toBeGreaterThan(0));
  return [...slot.container.querySelectorAll<HTMLElement>("[data-run-history-row]")];
};

const cell = (row: HTMLElement, name: string) => row.querySelector(`[data-history-cell='${name}']`)?.textContent;

describe("проект в строке истории", () => {
  it("колонки — тред, проект, flow, начало, конец, работа и расход; этапов среди них нет", async () => {
    const slot = openHistory([entry({ briefId: "a" })]);
    const head = within(await slot.findByRole("group", { name: "Сортировка истории" }));
    expect(head.getAllByRole("button").map((b) => b.textContent)).toEqual(["Тред", "Проект", "Flow", "Начало", "Конец", "Работа", "Расход"]);
  });

  it("название проекта треда стоит своей ячейкой", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a", project: "Cellular" })]));
    expect(cell(row!, "project")).toBe("Cellular");
  });

  it("у строки без проекта ячейка пустая, остальные на месте", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a", project: null })]));
    expect(cell(row!, "project")).toBe("");
    expect(cell(row!, "cost")).toBe("$12.5");
  });

  it("клик по заголовку «Проект» сортирует строки по названию проекта", async () => {
    const slot = openHistory([entry({ briefId: "a", project: "kasimov" }), entry({ briefId: "b", project: "Cellular" }), entry({ briefId: "c", project: "bb-plugins" })]);
    const projects = async () => (await rows(slot)).map((row) => cell(row, "project"));
    const head = within(await slot.findByRole("group", { name: "Сортировка истории" }));
    fireEvent.click(head.getByRole("button", { name: /Проект/ }));
    expect(await projects()).toEqual(["bb-plugins", "Cellular", "kasimov"]);
    fireEvent.click(head.getByRole("button", { name: /Проект/ }));
    expect(await projects()).toEqual(["kasimov", "Cellular", "bb-plugins"]);
  });
});

describe("моменты начала и конца", () => {
  it("сегодняшний момент — только время", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    expect(cell(row!, "started")).toBe("17:41");
    expect(cell(row!, "finished")).toBe("18:53");
  });

  it("вчера и раньше в этом году — DD.MM и время, прошлый год — DD.MM.YY и время", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a", startedAt: at(2025, 12, 28, 18, 30), finishedAt: at(2026, 9, 25, 18, 30) })]));
    expect(cell(row!, "started")).toBe("28.12.25 18:30");
    expect(cell(row!, "finished")).toBe("25.09 18:30");
  });

  it("минуты и расход — раздельные ячейки, этапов «сделано/всего» в строке нет", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    expect(cell(row!, "minutes")).toBe("42 мин");
    expect(cell(row!, "cost")).toBe("$12.5");
    expect(row!.textContent).not.toContain("2/2");
  });
});
