// @vitest-environment jsdom
// Страница flow: под названием — описание «когда выбирать», общих настроек на ней больше нет.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [
    { id: "default", name: "Default", stages: [], description: "Большие задачи со спекой" },
    { id: "quick", name: "Quick", stages: [] },
  ],
  minButtonWidth: 170,
};

const open = (subPath = "") =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => ({ hostId: "h", path: "/x/SKILL.md" }) } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("страница flow", () => {
  it("строк про корневой навык и ширину кнопки на ней нет", async () => {
    const slot = open();
    await slot.findByRole("textbox", { name: "Когда выбирать этот flow" });
    expect(slot.queryByRole("button", { name: "Корневой навык flow" })).toBeNull();
    expect(slot.queryByText("Корневой навык flow не найден в ~/.claude/skills")).toBeNull();
    expect(slot.queryByRole("spinbutton", { name: "Минимальная ширина кнопки, px" })).toBeNull();
  });

  it("описание выбранного flow стоит под названием", async () => {
    const slot = open();
    const name = await slot.findByRole("textbox", { name: "Название flow" });
    const description = slot.getByRole("textbox", { name: "Когда выбирать этот flow" }) as HTMLTextAreaElement;
    expect(description.value).toBe("Большие задачи со спекой");
    expect(name.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("описание сохраняется по уходу фокуса только у своего flow", async () => {
    const slot = open("quick");
    const description = await slot.findByRole("textbox", { name: "Когда выбирать этот flow" });
    fireEvent.change(description, { target: { value: "  Мелкие правки без спеки  " } });
    fireEvent.blur(description);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows.map((f) => f.description)).toEqual(["Большие задачи со спекой", "Мелкие правки без спеки"]));
  });

  it("стёртое описание снимается с flow", async () => {
    const slot = open();
    const description = await slot.findByRole("textbox", { name: "Когда выбирать этот flow" });
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.blur(description);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]).not.toHaveProperty("description"));
  });
});
