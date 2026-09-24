// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { ru } from "../lib/messages/ru";

afterEach(cleanup);

const land = (state: "now" | "fail") => ({
  id: "land",
  kind: "skill",
  name: "Влить и закрыть",
  executor: "self",
  state,
  results: [],
  minutes: null,
  cost: null,
  automation: {
    steps: [
      { id: "git.merge", label: "Merge the PR", state: "done", error: null },
      { id: "git.pull-main", label: "Pull main", state, error: state === "fail" ? "GitHub: not mergeable" : null },
      { id: "bb.archive", label: "Archive the thread", state: "todo", error: null },
    ],
  },
});

const view = (state: "now" | "fail") => ({
  current: "land",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  stages: [{ id: "review", kind: "skill", name: "Ревью", executor: "agent", state: "done", results: [], minutes: 12, cost: 4 }, land(state)],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, retryAutomation: () => ({ started: true }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

const segments = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-progress-segment]")];

describe("автоматизация в полосе прогресса", () => {

  it("раскрытая полоса показывает шаги под этапом по-русски, у упавшего — ошибку", async () => {
    const slot = await mount(view("fail"));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const steps = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")];
    expect(steps.map((s) => s.textContent)).toEqual([expect.stringContaining("Смёрджить PR"), expect.stringContaining(ru.steps["git.pull-main"]), expect.stringContaining("Архивировать тред")]);
    expect(steps[1]!.textContent).toContain("GitHub: not mergeable");
    expect(slot.container.querySelectorAll("[data-progress-row]")).toHaveLength(2);
  });

  it("«Повторить» на упавшем шаге зовёт retryAutomation", async () => {
    const slot = await mount(view("fail"));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    fireEvent.click(await screen.findByRole("button", { name: `Повторить шаг ${ru.steps["git.pull-main"]}` }));
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "retryAutomation")?.input).toEqual({ threadId: "thr_1", stage: "land" }));
  });
});

describe("выход из упавшего шага", () => {
  it("«Пропустить» на упавшем шаге зовёт skipAutomationStep", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    const slot = renderSlot(customization.banners![0]!, {}, {
      rpc: { getFlowProgress: () => view("fail"), skipAutomationStep: () => ({ started: true }) } as never,
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      settings: { language: "Русский" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    fireEvent.click(await screen.findByRole("button", { name: `Пропустить шаг ${ru.steps["git.pull-main"]}` }));
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "skipAutomationStep")?.input).toEqual({ threadId: "thr_1", stage: "land" }));
  });
});

describe("что сделал шаг автоматизации", () => {
  // Исполнитель выбрасывал строку успеха, и у сделанной автоматизации в списке
  // не было видно ни адреса PR, ни темы коммита, ни переведённых задач.
  const done = (id: string, label: string, detail: string | null) => ({ id, label, state: "done", error: null, detail });

  const withDetails = {
    current: "land",
    done: 1,
    step: 1,
    total: 1,
    planned: null,
    environmentId: null,
    stages: [
      {
        id: "land",
        kind: "skill",
        name: "Влить и закрыть",
        executor: "self",
        state: "done",
        results: [],
        minutes: 2,
        cost: 0.3,
        automation: {
          steps: [
            done("git.commit", "Commit", "fix(flow): номер этапа в полосе"),
            done("git.create-pr", "Open a PR", "https://github.com/e0068/bb-plugins/pull/474"),
            done("bb.tasks-done", "Task → done", "no linked tasks"),
          ],
        },
      },
    ],
  };

  it("адрес PR показан ссылкой, остальное — текстом", async () => {
    const slot = await mount(withDetails);
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const steps = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")];
    expect(steps[0]!.textContent).toContain("fix(flow): номер этапа в полосе");
    expect(steps[0]!.querySelector("[data-step-detail-link]")).toBeNull();
    expect(steps[1]!.querySelector<HTMLElement>("[data-step-detail-link]")!.textContent).toContain("pull/474");
    expect(steps[2]!.textContent).toContain("no linked tasks");
  });

  it("шаг без строки успеха остаётся одним именем", async () => {
    const slot = await mount(view("now"));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const steps = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")];
    expect(steps[0]!.querySelector("[data-step-detail]")).toBeNull();
  });
});
