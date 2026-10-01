// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { Toaster, toast } from "sonner";
import { afterEach, describe, expect, it } from "vitest";

import { ru } from "../lib/messages/ru";

// В треде Mail «Пропустить» в полосе прогона молча гасло и снова загоралось:
// ответ сервера никто не читал. Отказ и ошибка вызова теперь видны тостом —
// так же, как у кнопок в тосте об упавшем шаге.

afterEach(() => {
  act(() => void toast.dismiss());
  cleanup();
});

const STEP = ru.steps["git.pull-main"];

const view = (pull: { state: "now" | "fail"; skipQueued?: boolean }) => ({
  current: "land",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  stages: [
    { id: "review", kind: "skill", name: "Ревью", executor: "agent", state: "done", results: [], minutes: 12, cost: 4 },
    {
      id: "land",
      kind: "skill",
      name: "Влить и закрыть",
      executor: "self",
      state: pull.state,
      results: [],
      minutes: null,
      cost: null,
      automation: {
        steps: [
          { id: "git.merge", label: "Merge the PR", state: "done", error: null },
          { id: "git.pull-main", label: "Pull main", state: pull.state, error: pull.state === "fail" ? "GitHub: not mergeable" : null, skipQueued: pull.skipQueued ?? false },
        ],
      },
    },
  ],
});

const mount = async (progress: unknown, rpc: Record<string, () => unknown>) => {
  render(<Toaster />);
  const app = await loadPluginApp(() => import("../app"));
  const banner = app.composerCustomizations.find((c) => c.id === "flow-progress")!.banners![0]!;
  const slot = renderSlot(banner, {}, { rpc: { getFlowProgress: () => progress, ...rpc } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return slot;
};

describe("ответ на «Повторить» и «Пропустить» в полосе прогона", () => {
  it("отказ «не начат» — тост, что этап уже не ждёт", async () => {
    await mount(view({ state: "fail" }), { skipAutomationStep: () => ({ started: false }) });
    fireEvent.click(await screen.findByRole("button", { name: `Пропустить шаг ${STEP}` }));
    expect(await screen.findByText(/Этап «Влить и закрыть» уже не ждёт/)).toBeTruthy();
  });

  it("отказ из-за занятого треда — тост, что Flow сейчас повторяет шаг", async () => {
    await mount(view({ state: "fail" }), { retryAutomation: () => ({ started: false, busy: true }) });
    fireEvent.click(await screen.findByRole("button", { name: `Повторить шаг ${STEP}` }));
    expect(await screen.findByText(ru.notice.busy("Влить и закрыть"))).toBeTruthy();
  });

  it("упавший вызов — тост с его ошибкой", async () => {
    await mount(view({ state: "fail" }), {
      skipAutomationStep: () => {
        throw new Error("HTTP 503: plugin is reloading");
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: `Пропустить шаг ${STEP}` }));
    expect(await screen.findByText(/HTTP 503: plugin is reloading/)).toBeTruthy();
  });

  it("запомненный пропуск виден у идущего шага вместо кнопок", async () => {
    const slot = await mount(view({ state: "now", skipQueued: true }), {});
    const pull = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-step]")][1]!;
    expect(pull.textContent).toContain(ru.progress.skipQueued);
    expect(screen.queryByRole("button", { name: `Пропустить шаг ${STEP}` })).toBeNull();
  });
});
