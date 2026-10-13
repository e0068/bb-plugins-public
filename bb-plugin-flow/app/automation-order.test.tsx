// @vitest-environment jsdom
// Порядок шагов не запрет, а подсказка: flow сохраняется любым, а шаг, которому нужен открытый PR при пустом «Открыть PR» выше, помечен на чипе.
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
});

const catalog: StageCatalog = { skills: [{ name: "spec" }], executors: [] };

const chain = (id: string, name: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps: steps as never } });

const settings = (stages: WorkStage[]): FlowSettings => ({ flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), ...stages] }], minButtonWidth: 170 });

const open = (initial: FlowSettings, save: (input: unknown) => unknown = (input) => input) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: save, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });

const MARK = "Выше по flow нет «Открыть PR»: шаг сработает, если PR откроет другой flow, прошлый прогон или вы вручную";

describe("порядок шагов на странице", () => {
  it("убрали «Открыть PR» перед мёрджем: flow уезжает на сервер без отказа, шаг получает метку", async () => {
    const slot = open(settings([chain("flow-automation", "Слить", ["git.create-pr", "git.merge"])]));
    fireEvent.click(await slot.findByRole("button", { name: "Убрать шаг Открыть PR" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(true));
    expect(slot.queryByRole("alert")).toBeNull();
    expect(within(await slot.findByRole("listitem", { name: "Перетащить шаг Смёрджить PR" })).getByRole("img", { name: MARK })).toBeTruthy();
  });

  it("шаг после «Открыть PR» без метки, шаг до него — с меткой", async () => {
    const slot = open(settings([chain("a", "Цепочка", ["files.bump-patch", "git.create-pr", "git.merge"])]));
    const before = await slot.findByRole("listitem", { name: "Перетащить шаг Bump patch" });
    expect(within(before).getByRole("img", { name: MARK })).toBeTruthy();
    expect(within(slot.getByRole("listitem", { name: "Перетащить шаг Смёрджить PR" })).queryByRole("img")).toBeNull();
  });
});
