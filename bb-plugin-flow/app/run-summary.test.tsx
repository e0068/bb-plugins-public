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

  it("плитки считают исполнителей, работу, расход и простой", async () => {
    const slot = open(frozen());
    const tiles = within(await block(slot));
    expect(tiles.getByText("3")).toBeTruthy();
    expect(tiles.getByText("2 ч 6 м")).toBeTruthy();
    expect(tiles.getAllByText("$30.4").length).toBeGreaterThan(0);
    expect(tiles.getByText("54 м")).toBeTruthy();
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
