// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const flows = [{ id: "flow-plugin", name: "BB Plugin", stages: 11 }];

const bar = {
  current: "task",
  done: 0,
  step: 1,
  total: 1,
  planned: null,
  environmentId: null,
  stages: [{ id: "task", kind: "skill", name: "Задача", executor: "self", state: "todo", results: [], minutes: null, cost: null }],
};

const mount = async (state: { selected: string; current: string }) => {
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: {
      getFlowProgress: () => (state.current === "flow-plugin" ? bar : null),
      threadFlowChoice: () => ({ flows, ...state }),
      pickThreadFlow: ({ flowId }: { flowId: string }) => ((state.selected = flowId), { kind: "picked", selected: flowId }),
      applyThreadFlow: () => ((state.current = state.selected), { kind: "applied", flowId: state.selected }),
    } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  return slot;
};

const applyButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>("[data-flow-apply]");

describe("«Применить» у строки выбора flow", () => {
  it("выбор совпадает с flow треда — кнопки нет", async () => {
    const slot = await mount({ selected: "none", current: "none" });
    await screen.findByRole("button", { name: /Без flow/ });
    expect(applyButton(slot.container)).toBeNull();
  });

  it("другой выбор — «Применить» слева от шеврона; нажатие отдаёт flow треду и сменяет строку баром", async () => {
    const slot = await mount({ selected: "flow-plugin", current: "none" });
    const head = await screen.findByRole("button", { name: /Flow: BB Plugin/ });
    const button = await waitFor(() => applyButton(slot.container)!);
    expect(button.textContent).toBe("Применить");
    // Кнопка стоит в строке рядом с раскрывашкой, а не внутри неё: кнопка в кнопке недопустима.
    expect(button.parentElement).toBe(head.parentElement);
    expect(head.contains(button)).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "applyThreadFlow")?.input).toEqual({ threadId: "thr_1", locale: "ru" }));
    await waitFor(() => expect(slot.container.querySelector("[data-flow-choice]")).toBeNull());
    expect(slot.container.querySelector("[data-progress-count]")).not.toBeNull();
    expect(head.getAttribute("aria-expanded")).toBe("false");
  });
});
