// @vitest-environment jsdom
// «Задача → done» ждёт код треда в main: на странице flow шаг левее «Смёрджить PR» получает метку-предупреждение.
import { cleanup, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const catalog: StageCatalog = { skills: [], executors: [] };
const chain = (id: string, name: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps: steps as never } });

const open = (stages: WorkStage[]) => {
  const initial: FlowSettings = { flows: [{ id: "bug", name: "Bug", stages }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "bug" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

const MARK = "Станет красным: кода ещё нет в main — поставьте шаг после «Смёрджить PR»";
const OPEN = chain("ship", "Отправить", ["git.commit", "git.create-pr"]);

describe("«Задача → done» и «Смёрджить PR» на странице flow", () => {
  it("«Задача → done» левее «Смёрджить PR» помечен подсказкой", async () => {
    const slot = open([OPEN, chain("finalize", "Finalize", ["bb.tasks-done", "git.merge", "git.pull-main"])]);
    expect(within(await slot.findByRole("listitem", { name: "Перетащить шаг Задача → done" })).getByRole("img", { name: MARK })).toBeTruthy();
  });

  it("«Задача → done» правее «Смёрджить PR» без метки", async () => {
    const slot = open([OPEN, chain("finalize", "Finalize", ["git.merge", "git.pull-main", "bb.tasks-done"])]);
    expect(within(await slot.findByRole("listitem", { name: "Перетащить шаг Задача → done" })).queryByRole("img")).toBeNull();
  });
});
