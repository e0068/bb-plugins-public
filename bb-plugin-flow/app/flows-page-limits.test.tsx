// @vitest-environment jsdom
// Страница flow: под кнопками этапов — переключатели «Ограничивать навыки согласно Flow» и «Ограничивать агентов согласно Flow»
// рядом друг с другом, у каждого слева иконка навыка или агента.
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
    { id: "default", name: "Default", stages: [], limitSkills: true },
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
const SKILLS = "Ограничивать навыки согласно Flow";
const AGENTS = "Ограничивать агентов согласно Flow";

describe("переключатели ограничений на странице flow", () => {
  it("стоят под кнопками этапов и показывают сохранённое состояние своего flow", async () => {
    const slot = open();
    const skills = await slot.findByRole("switch", { name: SKILLS });
    const addStage = slot.getByRole("button", { name: "Добавить этап" });
    expect(addStage.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(skills.getAttribute("aria-checked")).toBe("true");
    expect(slot.getByRole("switch", { name: AGENTS }).getAttribute("aria-checked")).toBe("false");
  });

  it("стоят в одном ряду, у каждого слева от названия иконка", async () => {
    const slot = open();
    const skills = (await slot.findByRole("switch", { name: SKILLS })).closest("label")!;
    const agents = slot.getByRole("switch", { name: AGENTS }).closest("label")!;
    expect(skills.parentElement).toBe(agents.parentElement);
    expect(skills.parentElement!.className).toMatch(/\bflex-row\b|\bgrid-cols-2\b|@lg:grid-cols-2/);
    for (const [label, name] of [[skills, SKILLS], [agents, AGENTS]] as const) {
      const icon = label.querySelector("svg")!;
      expect(icon).not.toBeNull();
      expect(icon.compareDocumentPosition(slot.getByText(name)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("щелчок сохраняет переключатель только у своего flow", async () => {
    const slot = open("quick");
    fireEvent.click(await slot.findByRole("switch", { name: AGENTS }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows).toEqual([settings.flows[0], { id: "quick", name: "Quick", stages: [], limitAgents: true }]));
  });

  it("выключенный переключатель снимает поле", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("switch", { name: SKILLS }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]).toEqual({ id: "default", name: "Default", stages: [] }));
  });
});
