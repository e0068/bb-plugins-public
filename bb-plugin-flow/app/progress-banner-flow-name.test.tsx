// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const view = (flowName?: string) => ({
  current: "task",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  ...(flowName === undefined ? {} : { flowName }),
  stages: [
    { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: null },
    { id: "task", kind: "skill", name: "Задача", executor: "self", state: "now", results: [], minutes: null, cost: null },
  ],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

describe("название flow в баннере прогресса", () => {
  it("раскрытый баннер начинается строкой с названием flow, над строками этапов", async () => {
    const slot = await mount(view("Быстрый flow"));
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const title = slot.container.querySelector<HTMLElement>("[data-progress-flow]");
    expect(title?.textContent).toBe("Быстрый flow");
    const firstRow = slot.container.querySelector("[data-progress-row]")!;
    expect(title!.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("свёрнутый баннер названия не показывает", async () => {
    const slot = await mount(view("Быстрый flow"));
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(slot.container.querySelector("[data-progress-flow]")).toBeNull();
  });

  it("прогресс без названия — строки названия нет", async () => {
    const slot = await mount(view());
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    expect(slot.container.querySelectorAll("[data-progress-row]")).toHaveLength(2);
    expect(slot.container.querySelector("[data-progress-flow]")).toBeNull();
  });
});
