// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_FLOW } from "../core/flows";
import type { flowPickerRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

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
});
