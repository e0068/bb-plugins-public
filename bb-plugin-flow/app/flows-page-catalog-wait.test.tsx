// @vitest-environment jsdom
// Страница Flow не ждёт каталог навыков: сервер собирает его с диска почти секунду, а таблице этапов он нужен только в меню.
import { cleanup } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const task: WorkStage = { id: "task", kind: "skill", skill: "task-flow", name: "Task", executors: [] };
const settings: FlowSettings = { flows: [{ id: "default", name: "Default", stages: [task] }], minButtonWidth: 170 };

describe("страница Flow и каталог навыков", () => {
  it("таблица этапов встаёт, пока каталог навыков ещё собирается", async () => {
    const slot = renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "default" }, {
      rpc: { getFlowSettings: () => settings, getStageCatalog: () => new Promise(() => undefined), getRootSkill: () => null } as never,
      settings: { language: "Русский" },
    });
    expect(await slot.findByRole("button", { name: "Добавить этап" })).toBeTruthy();
  });
});
