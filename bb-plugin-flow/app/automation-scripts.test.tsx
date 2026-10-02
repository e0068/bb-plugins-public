// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Builtin = Extract<NonNullable<WorkStage["automation"]>, { source: "flow" }>;

const settings = (automation: Builtin): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { id: "flow-automation", kind: "skill", skill: "", name: "Опубликовать", executors: [], automation }] }],
  minButtonWidth: 170,
});
const catalog: StageCatalog = { skills: [], executors: [] };

const open = (initial: FlowSettings) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;
const lastAutomation = (slot: Slot) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages.at(-1)?.automation;

describe("«Добавить скрипт» в меню шагов", () => {

  it("шаг-скрипт виден тегом с именем файла и убирается крестом вместе со скриптом", async () => {
    const slot = open(settings({ source: "flow", steps: ["script:1", "git.commit"], scripts: [{ id: "1", name: "notify.py", content: "print(1)" }] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    expect(row.getAllByRole("listitem").map((t) => t.textContent)).toEqual(["notify.py", "Commit"]);
    fireEvent.click(row.getByRole("button", { name: "Убрать шаг notify.py" }));
    await vi.waitFor(() => expect(lastAutomation(slot)).toEqual({ source: "flow", steps: ["git.commit"], scripts: [] }));
  });
});

