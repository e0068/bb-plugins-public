// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

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

const summary = {
  startedAt: "2026-09-19T10:00:00.000Z",
  finishedAt: "2026-09-19T13:00:00.000Z",
  minutes: 126,
  wallMinutes: 180,
  idleMinutes: 54,
  cost: 30.4,
  stages: 13,
  skipped: 1,
  executors: [
    { id: "self", kind: "self", name: "self", stages: 11, cost: 22.7 },
    { id: "agent:reviewer", kind: "agent", name: "code-reviewer", model: "opus", stages: 1, cost: 4.1 },
    { id: "workflow:DEV2", kind: "workflow", name: "DEV2", stages: 1, cost: 3.6 },
  ],
};

const frozen = (patch: Record<string, unknown> = {}) => ({
  threadId: "thr_1",
  done: 2,
  total: 2,
  planned: { minutes: 125, target: 29.5, max: 53 },
  environmentId: null,
  flowName: "Разработка",
  summary,
  stages: [
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [{ label: "task.md", target: "docs/tasks/task.md" }], minutes: 6, cost: 1.8, number: 1 },
    { id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "done", results: [], minutes: 4, cost: 0.5, number: 2 },
  ],
  ...patch,
});

const open = (view: unknown) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        getRunSummary: ({ briefId }: { briefId: string }) => (briefId === "dec_demo" ? view : null),
      } as never,
      settings: { language: "Русский" },
    },
  );

const block = async (slot: { container: HTMLElement }) => {
  await waitFor(() => expect(slot.container.querySelector("[data-run-summary]")).not.toBeNull());
  return slot.container.querySelector<HTMLElement>("[data-run-summary]")!;
};

describe("итог завершённого прогона в ленте", () => {
  it("блок стоит под карточкой того брифа, который назвал сервер", async () => {
    const slot = open(frozen());
    const found = await block(slot);
    expect(found.textContent).toContain("Прогон завершён");
    expect(found.textContent).toContain("Разработка");
  });

  it("у карточки без замороженного итога блока нет", async () => {
    const slot = open(null);
    await waitFor(() => expect(slot.container.querySelector("[data-brief-card], [role=group]")).not.toBeNull());
    expect(slot.container.querySelector("[data-run-summary]")).toBeNull();
  });

  it("первая плитка считает исполнителей", async () => {
    const tiles = within(await block(open(frozen())));
    expect(tiles.getByText("3")).toBeTruthy();
  });

  it("вторая плитка — время: затрачено крупно, под ним план и ожидание", async () => {
    const tiles = within(await block(open(frozen())));
    expect(tiles.getByText("Затрачено")).toBeTruthy();
    expect(tiles.getByText("2 ч 6 мин")).toBeTruthy();
    expect(tiles.getByText("План 2 ч 5 мин")).toBeTruthy();
    expect(tiles.getByText("Ожидание 54 мин")).toBeTruthy();
    expect(tiles.queryByText("Ждал вас")).toBeNull();
  });

  it("третья плитка — деньги: расход и план через тире с пробелами", async () => {
    const tiles = within(await block(open(frozen())));
    expect(tiles.getByText("Расход")).toBeTruthy();
    expect(tiles.getAllByText("$30.4").length).toBeGreaterThan(0);
    expect(tiles.getByText("План $29.5 – 53")).toBeTruthy();
  });

  it("четвёртая плитка — задачи прогона ссылками на их карточки, с названиями", async () => {
    const taskStage = { ...frozen().stages[0]!, results: [{ label: "BBPL-7", target: "docs/tasks/in_progress/flow-itog.md", title: "Flow — итог прогона" }, { label: "spec.md", target: "docs/specs/BBPL-7-x.md" }] };
    const found = await block(open(frozen({ stages: [taskStage, frozen().stages[1]] })));
    const link = within(found).getByRole("link", { name: /BBPL-7/ });
    expect(link.getAttribute("href")).toBe("/plugins/tasks-plus/tasks/task/BBPL-7");
    expect(link.textContent).toContain("Flow — итог прогона");
    expect(within(found).queryByRole("link", { name: /spec/ })).toBeNull();
  });

  it("прогон без задач так и говорит в четвёртой плитке", async () => {
    const tiles = within(await block(open(frozen())));
    expect(tiles.getByText("Задачи")).toBeTruthy();
    expect(tiles.getByText("Связанных задач нет")).toBeTruthy();
  });

  it("обычный клик по задаче хост открывает в боковом сплите, а сам клик до основной области не доходит", async () => {
    const taskStage = { ...frozen().stages[0]!, results: [{ label: "BBPL-7", target: "docs/tasks/todo/a.md" }] };
    const found = await block(open(frozen({ stages: [taskStage] })));
    // Перехватчик ссылок хоста: погашенный клик пропускает, клик с Cmd/Ctrl открывает в сплите, прочий — в основной области.
    const calls: string[] = [];
    const host = (event: MouseEvent) => {
      if (event.defaultPrevented) return void calls.push("ignored");
      event.preventDefault();
      calls.push(event.metaKey || event.ctrlKey ? "split" : "navigate");
    };
    document.addEventListener("click", host);
    try {
      fireEvent.click(within(found).getByRole("link", { name: /BBPL-7/ }));
    } finally {
      document.removeEventListener("click", host);
    }
    expect(calls).toEqual(["split", "ignored"]);
  });

  it("список исполнителей раскрывается кнопкой", async () => {
    const slot = open(frozen());
    const found = await block(slot);
    expect(found.querySelectorAll("[data-run-executor]")).toHaveLength(0);
    fireEvent.click(within(found).getByRole("button", { name: /Кто именно/ }));
    await waitFor(() => expect(found.querySelectorAll("[data-run-executor]")).toHaveLength(3));
    expect(found.textContent).toContain("code-reviewer");
    expect(found.textContent).toContain("DEV2");
  });

  it("полоса прогона разворачивается в этапы со ссылками", async () => {
    const slot = open(frozen());
    const found = await block(slot);
    expect(found.querySelectorAll("[data-progress-row]")).toHaveLength(0);
    fireEvent.click(within(found).getByRole("button", { name: /Прогресс flow/ }));
    await waitFor(() => expect(found.querySelectorAll("[data-progress-row]")).toHaveLength(2));
    expect(found.textContent).toContain("task.md");
  });
});
