// @vitest-environment jsdom
// История прогонов таблицей: шапка колонок с сортировкой над раскрывающимися карточками.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [builtinStage("criteria", [])] }], minButtonWidth: 170 };

const entry = (patch: { briefId: string; title?: string | null; exists?: boolean; minutes?: number; cost?: number; finishedAt?: string }) => ({
  briefId: patch.briefId,
  threadId: `thr_${patch.briefId}`,
  title: patch.title === undefined ? `Тред ${patch.briefId}` : patch.title,
  exists: patch.exists ?? true,
  done: 2,
  total: 2,
  planned: null,
  environmentId: null,
  flowName: "Разработка",
  summary: {
    startedAt: "2026-09-20T10:00:00.000Z",
    finishedAt: patch.finishedAt ?? "2026-09-20T11:00:00.000Z",
    minutes: patch.minutes ?? 42,
    wallMinutes: 60,
    idleMinutes: 18,
    cost: patch.cost ?? 12.5,
    stages: 2,
    skipped: 0,
    executors: [{ id: "self", kind: "self", name: "self", stages: 2, cost: 12.5 }],
  },
  stages: [
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [{ label: "task.md", target: "docs/tasks/task.md" }], minutes: 30, cost: 10, number: 1 },
    { id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "done", results: [], minutes: 12, cost: 2.5, number: 2 },
  ],
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

const titles = async (slot: ReturnType<typeof openHistory>) => (await rows(slot)).map((row) => row.querySelector("[data-history-cell='title']")!.textContent);

const header = async (slot: ReturnType<typeof openHistory>) => within(await slot.findByRole("group", { name: "Сортировка истории" }));

const topRow = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-history-cell='flow']")!;

describe("шапка колонок истории", () => {
  it("без выбора — свежие по окончанию сверху, и шапка это называет", async () => {
    const slot = openHistory([entry({ briefId: "a", finishedAt: "2026-09-20T11:00:00.000Z" }), entry({ briefId: "b", finishedAt: "2026-09-21T11:00:00.000Z" })]);
    expect(await titles(slot)).toEqual(["Тред b", "Тред a"]);
    const active = (await header(slot)).getByRole("button", { pressed: true });
    expect(active.getAttribute("aria-label")).toBe("Конец, по убыванию");
  });

  it("клик по заголовку сортирует по колонке, повторный — в обратную сторону", async () => {
    const slot = openHistory([entry({ briefId: "a", cost: 3 }), entry({ briefId: "b", cost: 23 }), entry({ briefId: "c", cost: 9 })]);
    const head = await header(slot);
    fireEvent.click(head.getByRole("button", { name: /Расход/ }));
    expect(await titles(slot)).toEqual(["Тред b", "Тред c", "Тред a"]);
    expect(head.getByRole("button", { pressed: true }).getAttribute("aria-label")).toBe("Расход, по убыванию");
    fireEvent.click(head.getByRole("button", { name: /Расход/ }));
    expect(await titles(slot)).toEqual(["Тред a", "Тред c", "Тред b"]);
    expect(head.getByRole("button", { pressed: true }).getAttribute("aria-label")).toBe("Расход, по возрастанию");
  });

  it("название сортируется по видимой подписи, у удалённого треда — «Тред удалён»", async () => {
    const slot = openHistory([entry({ briefId: "a", title: "Яблоко" }), entry({ briefId: "b", title: null, exists: false }), entry({ briefId: "c", title: "Альфа" })]);
    fireEvent.click((await header(slot)).getByRole("button", { name: /Тред/ }));
    expect(await titles(slot)).toEqual(["Альфа", "Тред удалён", "Яблоко"]);
  });
});

describe("строка истории", () => {
  it("клик в любом месте свёрнутой карточки раскрывает её, и этапы прогона видны сразу", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    expect(row!.querySelector("[data-run-summary-body]")).toBeNull();
    fireEvent.click(topRow(row!));
    const body = await waitFor(() => row!.querySelector<HTMLElement>("[data-run-summary-body]")!);
    expect(body.querySelectorAll("[data-progress-row]")).toHaveLength(2);
    expect(body.textContent).toContain("task.md");
    expect(within(row!).getByRole("button", { name: /Свернуть итог прогона/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("клик внутри итога карточку не сворачивает, клик по верхней строке — сворачивает", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    fireEvent.click(topRow(row!));
    const body = await waitFor(() => row!.querySelector<HTMLElement>("[data-run-summary-body]")!);
    fireEvent.click(body);
    expect(row!.querySelector("[data-run-summary-body]")).not.toBeNull();
    fireEvent.click(topRow(row!));
    expect(row!.querySelector("[data-run-summary-body]")).toBeNull();
  });

  it("шеврон — кнопка с aria-expanded: с клавиатуры карточка раскрывается и сворачивается", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    const chevron = within(row!).getByRole("button", { name: /Раскрыть итог прогона/ });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron, { detail: 0 });
    expect(chevron.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(chevron, { detail: 0 });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
  });

  it("клик по названию открывает тред и не раскрывает карточку", async () => {
    const slot = openHistory([entry({ briefId: "a" })]);
    const [row] = await rows(slot);
    fireEvent.click(within(row!).getByRole("button", { name: "Тред a" }));
    expect(slot.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread", threadId: "thr_a" }));
    expect(row!.querySelector("[data-run-summary-body]")).toBeNull();
  });

  it("выделение текста мышью карточку не переключает", async () => {
    const [row] = await rows(openHistory([entry({ briefId: "a" })]));
    vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Разработка" } as Selection);
    fireEvent.click(topRow(row!), { detail: 1 });
    expect(row!.querySelector("[data-run-summary-body]")).toBeNull();
  });
});
