// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { ru } from "../lib/messages/ru";

afterEach(cleanup);

type StepState = "wait" | "now" | "fail" | "done" | "todo";

const publish = (first: StepState, second: StepState = "todo") => ({
  id: "publish",
  kind: "action",
  name: "Опубликовать",
  executor: "self",
  state: first === "fail" ? "fail" : "now",
  results: [],
  minutes: null,
  cost: null,
  automation: {
    steps: [
      { id: "git.create-pr", label: "Open a PR", state: first, error: first === "fail" ? "GitHub: not mergeable" : null },
      { id: "bb.tasks-in-review", label: "Task → in_review", state: second, error: null },
    ],
  },
});

const view = (first: StepState, second: StepState = "todo") => ({
  current: "publish",
  done: 1,
  step: 2,
  total: 3,
  planned: null,
  environmentId: null,
  stages: [{ id: "review", kind: "skill", name: "Ревью", executor: "agent", state: "done", results: [], minutes: 12, cost: 4 }, publish(first, second), { id: "demo", kind: "demo", name: "Демонстрация", executor: "self", state: "todo", results: [], minutes: null, cost: null }],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, runActionStep: () => ({ started: true }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

const expand = async () => fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));

const runLabel = ru.progress.actionRun(ru.steps["git.create-pr"]);

describe("кнопки шагов этапа Action", () => {
  it("ждущий нажатия шаг показан кнопкой с именем шага", async () => {
    const slot = await mount(view("wait"));
    await expand();
    const button = await screen.findByRole("button", { name: runLabel });
    expect(button.textContent).toContain(ru.steps["git.create-pr"]);
    expect(button.hasAttribute("disabled")).toBe(false);
    // Кнопка — только у ждущего шага: следующий ждёт своей очереди.
    expect(slot.container.querySelectorAll("[data-action-step]")).toHaveLength(1);
  });

  it("нажатие зовёт runActionStep и до ответа держит кнопку выключенной", async () => {
    const slot = await mount(view("wait"));
    await expand();
    fireEvent.click(await screen.findByRole("button", { name: runLabel }));
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "runActionStep")?.input).toEqual({ threadId: "thr_1", stage: "publish" }));
  });

  it("идущий шаг показан лоадером, и нажать его второй раз нельзя", async () => {
    await mount(view("now"));
    await expand();
    const button = await screen.findByRole("button", { name: ru.progress.actionBusy });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector("[data-action-spinner]")).not.toBeNull();
  });

  it("упавший шаг показывает ошибку и «Повторить», а «Пропустить» у Action нет", async () => {
    const slot = await mount(view("fail"));
    await expand();
    expect(await screen.findByRole("button", { name: ru.progress.retryStep(ru.steps["git.create-pr"]) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: ru.progress.skipStep(ru.steps["git.create-pr"]) })).toBeNull();
    expect(slot.container.textContent).toContain("GitHub: not mergeable");
  });

  it("повтор упавшего шага Action зовёт тот же runActionStep", async () => {
    const slot = await mount(view("fail"));
    await expand();
    fireEvent.click(await screen.findByRole("button", { name: ru.progress.retryStep(ru.steps["git.create-pr"]) }));
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "runActionStep")?.input).toEqual({ threadId: "thr_1", stage: "publish" }));
  });

  it("свёрнутая полоса показывает ждущий шаг отдельной строкой с той же кнопкой", async () => {
    const slot = await mount(view("wait"));
    const bar = await screen.findByText(ru.progress.actionWaiting("Опубликовать", 1, 2));
    expect(bar).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-action-step]")).toHaveLength(1);
    expect(await screen.findByRole("button", { name: runLabel })).toBeTruthy();
  });

  it("пройденный этап Action кнопок не показывает", async () => {
    await mount(view("done", "done"));
    await expand();
    expect(screen.queryByRole("button", { name: runLabel })).toBeNull();
  });
});
