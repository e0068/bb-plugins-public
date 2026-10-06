// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

/** Задачи, которые «знает» Tasks+, — по треду, из которого спрашивают. */
const TASKS: Record<string, Record<string, object>> = {
  thr_1: {
    "flow-byudzhet-brifa": { key: "flow-byudzhet-brifa", title: "Бюджет брифа из ветки", description: "## Проблема\n\nНоль в бюджете", status: "in_review", priority: "none" },
    "BBPL-7": { key: "BBPL-7", title: "Срочная задача", description: "", status: "todo", priority: "urgent" },
  },
};

const requests: Array<{ url: string; body: { taskKey: string; callerThreadId: string } }> = [];

const tasksPlus = (broken: Set<string>) =>
  vi.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { taskKey: string; callerThreadId: string };
    requests.push({ url, body });
    if (broken.has(body.taskKey)) return new Response("boom", { status: 500 });
    const task = TASKS[body.callerThreadId]?.[body.taskKey] ?? null;
    return new Response(JSON.stringify({ ok: true, result: { task: task === null ? null : { id: "x", ...task } } }), { status: 200 });
  });

beforeEach(() => {
  window.localStorage.clear();
  requests.length = 0;
  vi.stubGlobal("fetch", tasksPlus(new Set(["BBPL-9"])));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const demo: DecisionBrief = {
  id: "dec_demo_tasks",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-06T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Merge",
    done: ["Бюджет от объёма"],
    pending: [],
    tasks: [
      { key: "flow-byudzhet-brifa", done: true, note: "модель цены" },
      { key: "BBPL-7", done: false },
      { key: "BBPL-8", done: false },
      { key: "BBPL-9", done: false },
      { key: "кривой ключ", done: false },
    ],
    results: [{ label: "PR #1", target: "https://github.com/e0068/bb-plugins/pull/1" }],
  },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: demo, answer: null }), answerBrief: () => ({ kind: "not_found" }) }, openThreadPanel: () => true },
  );

const shown = async () => {
  const slot = open();
  await slot.findByText("Бюджет брифа из ветки");
  await slot.findByText("Срочная задача");
  const group = (title: string) => slot.getByText(title, { selector: "div" }).parentElement!;
  return { slot, group };
};

/**
 * Задачи Демонстрации — карточки Tasks+ в самом окне: Markdown для плагинов директиву `::task` не рисует, поэтому
 * Flow спрашивает задачу у Tasks+ сам, с тредом брифа, и рисует карточку по её коду. Клик открывает задачу сбоку.
 */
describe("задачи в демонстрации", () => {
  it("задача — карточкой с заголовком из Tasks+, а не строкой директивы", async () => {
    const { slot, group } = await shown();
    expect(within(group("Review")).getByText("Бюджет брифа из ветки")).toBeTruthy();
    expect(within(group("Created")).getByText("Срочная задача")).toBeTruthy();
    expect(slot.container.textContent).not.toContain("::task");
  });

  it("Tasks+ спрашивают с тредом брифа — задача из ветки треда находится", async () => {
    await shown();
    expect(requests.map((r) => r.url)).toContain("/api/v1/plugins/tasks-plus/rpc/getTaskByKey");
    expect(requests.find((r) => r.body.taskKey === "flow-byudzhet-brifa")?.body.callerThreadId).toBe("thr_1");
  });

  it("задачи нет или Tasks+ не ответил — пунктирная карточка с ключом и причиной", async () => {
    const { group } = await shown();
    const created = group("Created");
    expect(await within(created).findByText(/not found|не найдена/i)).toBeTruthy();
    expect(await within(created).findByText(/couldn't load|не удалось/i)).toBeTruthy();
    expect(within(created).getByText("BBPL-8")).toBeTruthy();
    expect(within(created).getByText("BBPL-9")).toBeTruthy();
  });

  it("ключ, который задачу не адресует, — текстом и без запроса", async () => {
    const { group } = await shown();
    expect(within(group("Created")).getByText("кривой ключ")).toBeTruthy();
    expect(requests.some((r) => r.body.taskKey === "кривой ключ")).toBe(false);
  });

  it("клик по карточке открывает задачу во вкладке Flow сбоку", async () => {
    const { slot } = await shown();
    fireEvent.click(slot.getByRole("button", { name: /Бюджет брифа из ветки/ }));
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "task", title: "flow-byudzhet-brifa", params: { taskKey: "flow-byudzhet-brifa", threadId: "thr_1" } },
    });
  });

  it("вкладка сбоку показывает задачу на чтение — заголовок и описание", async () => {
    const panel = app.threadPanelActions.find((action) => action.id === "task")!;
    const slot = renderSlot<PluginThreadPanelProps>(panel, { threadId: "thr_1", params: { taskKey: "flow-byudzhet-brifa", threadId: "thr_1" } });
    expect(await slot.findByText("Бюджет брифа из ветки")).toBeTruthy();
    expect(slot.container.textContent).toContain("Ноль в бюджете");
  });
});
