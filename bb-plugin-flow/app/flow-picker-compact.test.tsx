// @vitest-environment jsdom
// Кнопка flow в композере на узком экране: меню кита превращается в нижнюю
// шторку, и список flow должен быть в ней целиком.
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPACT_VIEWPORT_QUERY } from "../components/ui/hooks/use-compact-viewport";
import { NO_FLOW } from "../core/flows";
import type { flowPickerRpcContract } from "../shared/contract";

window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}) as MediaQueryList;

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const customization = () => app.composerCustomizations.find((c) => c.id === "flow")!;
const choice = { flows: [{ id: "default", name: "Default" }, { id: "quick", name: "Quick" }], selected: "default" };

const open = (selected = "default") =>
  renderSlot<object, typeof flowPickerRpcContract>(customization().actions![0]!, {}, {
    rpc: { getFlowChoice: () => ({ ...choice, selected }), setFlowChoice: (input: { flowId: string }) => ({ selected: input.flowId }) } as never,
    composer: { scope: { kind: "new-thread", projectId: "proj_a" } },
    settings: { language: "Русский" },
  });

describe("выбор flow на узком экране", () => {
  it("в шторке видны все flow проекта и «Без flow»", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /Default/ }));
    expect(await slot.findByRole("menuitemradio", { name: "Default" })).toBeTruthy();
    expect(await slot.findByRole("menuitemradio", { name: "Quick" })).toBeTruthy();
    expect(await slot.findByRole("menuitemradio", { name: "Без flow" })).toBeTruthy();
  });

  it("текущий выбор помечен, остальные пункты нет", async () => {
    const slot = open("quick");
    fireEvent.click(await slot.findByRole("button", { name: /Quick/ }));
    expect((await slot.findByRole("menuitemradio", { name: "Quick" })).getAttribute("aria-checked")).toBe("true");
    expect((await slot.findByRole("menuitemradio", { name: "Default" })).getAttribute("aria-checked")).toBe("false");
  });

  it("нажатие на пункт ставит flow проекту и закрывает шторку", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /Default/ }));
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Quick" }));
    await vi.waitFor(() => expect(slot.rpcCalls.at(-1)).toEqual({ method: "setFlowChoice", input: { projectId: "proj_a", flowId: "quick" } }));
    expect(await slot.findByRole("button", { name: /Quick/ })).toBeTruthy();
    await vi.waitFor(() => expect(slot.queryByRole("menuitemradio", { name: "Default" })).toBeNull());
  });

  it("«Без flow» тоже выбирается из шторки", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /Default/ }));
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Без flow" }));
    await vi.waitFor(() => expect(slot.rpcCalls.at(-1)).toEqual({ method: "setFlowChoice", input: { projectId: "proj_a", flowId: NO_FLOW } }));
  });
});
