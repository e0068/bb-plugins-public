// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planner } from "../core/stages-fixtures";
import { builtinStage, stageKindOf } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [
    {
      id: "default",
      name: "Default",
      stages: [
        builtinStage("questions", []),
        builtinStage("select", []),
        { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] },
        { id: "plan", kind: "skill", skill: "plan", name: "План", executors: [planner] },
        builtinStage("demo", []),
      ],
    },
    { id: "quick", name: "Quick", stages: [builtinStage("criteria", []), { id: "implement", kind: "skill", skill: "code", name: "Код", executors: [] }] },
  ],
  minButtonWidth: 170,
};

const catalog: StageCatalog = {
  skills: [{ name: "spec", description: "Спецификация задачи" }, { name: "plan" }],
  executors: [planner, { id: "workflow:DEV2", kind: "workflow", name: "DEV2", description: "конвейер" }],
};

const open = (options: { subPath?: string; language?: string; initial?: FlowSettings } = {}) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: options.subPath ?? "" }, {
    rpc: { getFlowSettings: () => options.initial ?? settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: options.language ?? "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const flowOf = (saved: FlowSettings | undefined, id: string) => saved?.flows.find((f) => f.id === id);
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));

describe("список flow и строки этапов", () => {
  it("без адреса открыта таблица этапов первого flow", async () => {
    const slot = open();
    expect((await row(slot, 3)).getByRole("textbox", { name: "Название этапа 3" })).toBeTruthy();
  });

  it("flow из адреса открывается сразу", async () => {
    const slot = open({ subPath: "quick" });
    expect(((await row(slot, 2)).getByRole("textbox", { name: "Название этапа 2" }) as HTMLInputElement).value).toBe("Код");
  });

  it("имя flow правится на месте", async () => {
    const slot = open();
    const name = await slot.findByRole("textbox", { name: "Название flow" });
    fireEvent.change(name, { target: { value: "Большая фича" } });
    fireEvent.blur(name);
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.name).toBe("Большая фича"));
  });

  it("фокусная рамка имени рисуется внутри поля — снаружи её срезала бы прокрутка страницы", async () => {
    const slot = open();
    expect((await slot.findByRole("textbox", { name: "Название flow" })).className).toContain("focus-visible:ring-inset");
  });

  it("название этапа навыка сохраняется само, без ухода фокуса", async () => {
    const slot = open();
    fireEvent.change((await row(slot, 4)).getByRole("textbox", { name: "Название этапа 4" }), { target: { value: "План работ" } });
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages[3]?.name).toBe("План работ"), { timeout: 2000 });
  });

  it("тег исполнителя убирается крестом", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 4)).getByRole("button", { name: "Убрать planner" }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages[3]?.executors).toEqual([]));
  });
});
