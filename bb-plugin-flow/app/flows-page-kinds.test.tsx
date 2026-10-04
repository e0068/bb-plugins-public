// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planner } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
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

describe("таблица этапов выбранного flow", () => {
  it("в таблице нет Review by User — ни в шапке, ни в строках", async () => {
    const slot = open();
    await row(slot, 3);
    expect(slot.queryByRole("button", { name: "Review by User" })).toBeNull();
    expect(slot.queryByLabelText("Review by User")).toBeNull();
  });

  it("строка, перетащенная за ручку вниз, встаёт в конец и порядок сохраняется на отпускании", async () => {
    const slot = open();
    const handle = (await row(slot, 1)).getByRole("button", { name: "Перетащить этап Вопросы" });
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientY: 500 });
    fireEvent.pointerUp(window);
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.map((s) => s.id).at(-1)).toBe("questions"));
  });
});
