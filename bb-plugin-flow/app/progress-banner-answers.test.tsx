// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const ANSWERS = ["Как сообщить агенту? — Строкой в идущий ход", "«Применить» в идущем баре? — Нет, как сейчас"];

const view = (answers?: readonly string[]) => ({
  current: "task",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  ...(answers === undefined ? {} : { answers }),
  stages: [
    { id: "questions", kind: "questions", name: "Вопросы", executor: "self", state: "done", results: [], minutes: 2, cost: null },
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

describe("строка Вопросов в баннере прогресса", () => {
  it("клик по строке показывает ответы владельца списком, повторный — прячет", async () => {
    const slot = await mount(view(ANSWERS));
    expect(slot.container.querySelector("[data-progress-answers]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Вопросы/ }));
    expect([...slot.container.querySelectorAll("[data-progress-answers] li")].map((li) => li.textContent)).toEqual(ANSWERS);
    fireEvent.click(screen.getByRole("button", { name: /Вопросы/ }));
    expect(slot.container.querySelector("[data-progress-answers]")).toBeNull();
  });

  it("ответов нет — строка не раскрывается", async () => {
    await mount(view());
    expect(screen.queryByRole("button", { name: /Вопросы/ })).toBeNull();
  });
});
