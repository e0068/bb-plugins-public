// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const ITEMS = ["Этап «Утверждение» ставится в flow", "Кнопка «Утвердить» ведёт прогон дальше"];

const view = (criteria?: readonly string[]) => ({
  current: "task",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  ...(criteria === undefined ? {} : { criteria }),
  stages: [
    { id: "criteria", kind: "criteria", name: "Definition of Done", executor: "self", state: "done", results: [], minutes: 3, cost: null },
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "now", results: [], minutes: null, cost: null },
  ],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return slot;
};

describe("строка Definition of Done в баннере прогресса", () => {
  it("клик по строке показывает утверждённые пункты по порядку, повторный — прячет", async () => {
    const slot = await mount(view(ITEMS));
    expect(slot.container.querySelector("[data-progress-criteria]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Definition of Done/ }));
    const items = [...slot.container.querySelectorAll("[data-progress-criteria] li")].map((li) => li.textContent);
    expect(items).toEqual(ITEMS);
    fireEvent.click(screen.getByRole("button", { name: /Definition of Done/ }));
    expect(slot.container.querySelector("[data-progress-criteria]")).toBeNull();
  });

  it("утверждённых пунктов нет — строка не раскрывается", async () => {
    await mount(view());
    expect(screen.queryByRole("button", { name: /Definition of Done/ })).toBeNull();
  });
});
