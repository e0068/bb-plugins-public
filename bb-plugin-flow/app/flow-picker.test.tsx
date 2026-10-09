// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_FLOW } from "../core/flows";
import type { flowPickerRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));
// Модуль с SDK — только после загрузки приложения, иначе SDK поднимется раньше харнесса.
const { forgetShownFlowChoices } = await import("./flow-picker");

afterEach(cleanup);
afterEach(forgetShownFlowChoices);

const customization = () => app.composerCustomizations.find((c) => c.id === "flow")!;
const choice = { flows: [{ id: "default", name: "Default" }, { id: "quick", name: "Quick" }], selected: "default" };

const open = (scope: { kind: "new-thread"; projectId: string | null } | { kind: "thread"; threadId: string }, selected = "default") =>
  renderSlot<object, typeof flowPickerRpcContract>(customization().actions![0]!, {}, {
    rpc: { getFlowChoice: () => ({ ...choice, selected }), setFlowChoice: (input: { flowId: string }) => ({ selected: input.flowId }) } as never,
    composer: { scope },
    settings: { language: "Русский" },
  });

describe("кнопка flow в композере", () => {
  it("кнопка зарегистрирована только для композера нового треда", () => {
    expect(customization().scopes).toEqual(["new-thread"]);
  });

  it("в композере треда кнопки нет", async () => {
    const slot = open({ kind: "thread", threadId: "thr_1" });
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.queryByRole("button")).toBeNull();
  });

  it("в новом треде видно имя выбранного flow", async () => {
    const slot = open({ kind: "new-thread", projectId: "proj_a" });
    expect(await slot.findByRole("button", { name: /Default/ })).toBeTruthy();
    expect(slot.rpcCalls[0]).toEqual({ method: "getFlowChoice", input: { projectId: "proj_a" } });
  });

  it("иконка — знак плагина, имя кнопки полное, а подпись «Flow:» на узком экране прячется", async () => {
    const slot = open({ kind: "new-thread", projectId: "proj_a" });
    const trigger = await slot.findByRole("button", { name: "Flow: Default" });
    expect(trigger.querySelector("path")?.getAttribute("d")).toBe("M6 2.25h7.25a4.25 4.25 0 0 1 0 8.5h-2.5a4.25 4.25 0 0 0 0 8.5H17");
    expect(within(trigger).getByText("Flow: Default").className).toContain("max-md:hidden");
    expect(within(trigger).getByText("Default").className).toContain("md:hidden");
  });

  it("выбор другого flow записывает выбор проекта и показывает его имя", async () => {
    const slot = open({ kind: "new-thread", projectId: "proj_a" });
    const trigger = await slot.findByRole("button", { name: /Default/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Quick" }));
    await vi.waitFor(() => expect(slot.rpcCalls.at(-1)).toEqual({ method: "setFlowChoice", input: { projectId: "proj_a", flowId: "quick" } }));
    expect(await slot.findByRole("button", { name: /Quick/ })).toBeTruthy();
  });

  it("в списке есть «Без flow»: им тред отказывается от flow", async () => {
    const slot = open({ kind: "new-thread", projectId: "proj_a" });
    const trigger = await slot.findByRole("button", { name: /Default/ });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Без flow" }));
    await vi.waitFor(() => expect(slot.rpcCalls.at(-1)).toEqual({ method: "setFlowChoice", input: { projectId: "proj_a", flowId: NO_FLOW } }));
  });

  it("при выбранном «Без flow» на кнопке остаётся одна иконка без подписи", async () => {
    const slot = open({ kind: "new-thread", projectId: "proj_a" }, NO_FLOW);
    const trigger = await slot.findByRole("button", { name: "Без flow" });
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelector("svg")).toBeTruthy();
  });

  // Своя иконка flow из Hugeicons без размера рисовалась 24 px рядом со знаком flow в 16 px и прилипала к названию.
  it("своя иконка flow в меню и на кнопке того же размера, что знак flow, и отделена от названия", async () => {
    const slot = renderSlot<object, typeof flowPickerRpcContract>(customization().actions![0]!, {}, {
      rpc: { getFlowChoice: () => ({ flows: [...choice.flows, { id: "bug", name: "Bug", icon: "Album01" }], selected: "bug" }), setFlowChoice: () => ({ selected: "bug" }) } as never,
      composer: { scope: { kind: "new-thread", projectId: "proj_a" } },
      settings: { language: "Русский" },
    });
    const trigger = await slot.findByRole("button", { name: "Flow: Bug" });
    expect(trigger.querySelector("svg[data-icon='Album01']")?.getAttribute("class")).toContain("size-4");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    const items = await slot.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Автоматически", "Default", "Quick", "Bug", "Без flow"]);
    for (const item of items) {
      expect(item.className).toContain("gap-2");
      expect(item.querySelector(":scope > svg")?.getAttribute("class")).toContain("size-4");
    }
  });
});

// bb монтирует кнопку заново на каждой смене проекта в композере Home. Пустая до
// ответа сервера, она на кадр-два пропадала, и панель композера прыгала вбок.
describe("перемонтирование кнопки flow", () => {
  const mount = (projectId: string, getFlowChoice: () => unknown) =>
    renderSlot<object, typeof flowPickerRpcContract>(customization().actions![0]!, {}, {
      rpc: { getFlowChoice, setFlowChoice: (input: { flowId: string }) => ({ selected: input.flowId }) } as never,
      composer: { scope: { kind: "new-thread", projectId } },
      settings: { language: "Русский" },
    });
  const silent = () => new Promise<never>(() => {});

  it("в знакомом проекте кнопка сразу стоит с его выбором, не дожидаясь сервера", async () => {
    const first = mount("proj_seen", () => ({ ...choice, selected: "quick" }));
    await first.findByRole("button", { name: "Flow: Quick" });
    first.unmount();

    const second = mount("proj_seen", silent);
    expect(second.getByRole("button", { name: "Flow: Quick" })).toBeTruthy();
  });

  it("в незнакомом проекте кнопка стоит с последним показанным выбором, пока сервер не ответил", async () => {
    const first = mount("proj_before", () => ({ ...choice, selected: "quick" }));
    await first.findByRole("button", { name: "Flow: Quick" });
    first.unmount();

    let answer: (value: typeof choice) => void = () => {};
    const second = mount("proj_new", () => new Promise((resolve) => (answer = resolve)));
    expect(second.getByRole("button", { name: "Flow: Quick" })).toBeTruthy();
    answer({ ...choice, selected: "default" });
    expect(await second.findByRole("button", { name: "Flow: Default" })).toBeTruthy();
  });
});
