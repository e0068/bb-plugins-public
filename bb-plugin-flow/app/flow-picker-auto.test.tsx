// @vitest-environment jsdom
// «Автоматически» в кнопке flow: первый пункт меню; выбран — на кнопке один знак Flow,
// а у «Без flow» знак перечёркнут, чтобы два состояния без подписи не путались.
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import type { flowPickerRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const customization = () => app.composerCustomizations.find((c) => c.id === "flow")!;
const choice = { flows: [{ id: "default", name: "Default" }, { id: "quick", name: "Quick" }], selected: "default" };

const open = (selected: string) =>
  renderSlot<object, typeof flowPickerRpcContract>(customization().actions![0]!, {}, {
    rpc: { getFlowChoice: () => ({ ...choice, selected }), setFlowChoice: (input: { flowId: string }) => ({ selected: input.flowId }) } as never,
    composer: { scope: { kind: "new-thread", projectId: "proj_a" } },
    settings: { language: "Русский" },
  });

const menu = async (slot: ReturnType<typeof open>, name: RegExp | string) => {
  const trigger = await slot.findByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return slot.findAllByRole("menuitemradio");
};

describe("«Автоматически» в кнопке flow", () => {
  it("первый пункт меню — «Автоматически», последний — «Без flow»", async () => {
    const slot = open("default");
    const items = await menu(slot, /Default/);
    expect(items.map((item) => item.textContent)).toEqual(["Автоматически", "Default", "Quick", "Без flow"]);
  });

  it("выбор «Автоматически» записывает выбор проекта", async () => {
    const slot = open("default");
    await menu(slot, /Default/);
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Автоматически" }));
    await vi.waitFor(() => expect(slot.rpcCalls.at(-1)).toEqual({ method: "setFlowChoice", input: { projectId: "proj_a", flowId: AUTO_FLOW } }));
  });

  it("при «Автоматически» на кнопке один знак Flow без подписи", async () => {
    const slot = open(AUTO_FLOW);
    const trigger = await slot.findByRole("button", { name: "Автоматически" });
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelectorAll("path")).toHaveLength(2);
  });

  it("у «Без flow» знак перечёркнут: в нём на линию больше, чем у «Автоматически»", async () => {
    const slot = open(NO_FLOW);
    const trigger = await slot.findByRole("button", { name: "Без flow" });
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelectorAll("path")).toHaveLength(3);
  });
});
