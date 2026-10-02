// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ru } from "../lib/messages/ru";
import { actionStage, builtinStage } from "../lib/stage-constants";
import type { AutomationStep, FlowSettings, StageCatalog, WorkStage, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = (extra: WorkStage[] = []): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }, ...extra] }],
  minButtonWidth: 170,
});
const catalog: StageCatalog = { skills: [{ name: "spec" }], executors: [] };

const open = (initial: FlowSettings = settings()) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages;

const publish = (steps: AutomationStep[]): WorkStage => ({ ...actionStage([]), name: "Опубликовать", automation: { source: "flow", steps } });

describe("этап Action в таблице этапов", () => {

  it("шаг этапа Action убирается крестом", async () => {
    const slot = open(settings([publish(["git.create-pr", "bb.tasks-in-review"])]));
    fireEvent.click(await slot.findByRole("button", { name: ru.settings.removeStep(ru.steps["git.create-pr"]) }));
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)?.automation).toMatchObject({ steps: ["bb.tasks-in-review"] }));
  });

  it("этап Action переименовывается, как встроенная автоматизация", async () => {
    const slot = open(settings([publish([])]));
    fireEvent.change(await slot.findByRole("textbox", { name: ru.settings.stageName(3) }), { target: { value: "Выпустить" } });
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)?.name).toBe("Выпустить"));
  });
});
