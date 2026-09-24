// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
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

describe("шаги по открытому PR в меню шагов", () => {
  it("пока PR никто не открывает, Bump и Merge выбрать нельзя", async () => {
    const slot = open(settings([chain("flow-automation", "Коммит", ["git.commit"])]));
    fireEvent.click((await slot.findAllByRole("button", { name: "Добавить шаг" }))[0]!);
    expect((await slot.findByRole("menuitem", { name: "Bump patch" })).getAttribute("aria-disabled")).toBe("true");
    expect((await slot.findByRole("menuitem", { name: "Смёрджить PR" })).getAttribute("aria-disabled")).toBe("true");
    expect((await slot.findByRole("menuitem", { name: "Открыть PR" })).getAttribute("aria-disabled")).toBe("false");
  });

  it("за цепочкой, открывающей PR, те же шаги доступны", async () => {
    const slot = open(settings([chain("flow-automation", "Открыть", ["git.create-pr"]), chain("flow-automation-2", "Влить", [])]));
    const buttons = await slot.findAllByRole("button", { name: "Добавить шаг" });
    fireEvent.click(buttons.at(-1)!);
    expect((await slot.findByRole("menuitem", { name: "Смёрджить PR" })).getAttribute("aria-disabled")).toBe("false");
  });
});

describe("отказ сохранения на странице", () => {
  it("запрещённый порядок не уезжает на сервер, причина написана по-русски, таблица на месте", async () => {
    // Порядок, который меню не даёт собрать, приходит из перетаскивания и
    // удаления шага: сохранение ловит его тем же правилом, что и сервер.
    const slot = open(settings([chain("flow-automation", "Слить", ["git.create-pr", "git.merge"])]));
    fireEvent.click(await slot.findByRole("button", { name: "Убрать шаг Открыть PR" }));
    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toContain("«Смёрджить PR» в этапе «Слить» стоит раньше «Открыть PR»");
    expect(await slot.findByRole("table", { name: "Этапы работ" })).toBeTruthy();
    expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(false);
  });

  it("серверный отказ, если он всё же пришёл, показан как есть", async () => {
    const slot = open(settings([chain("flow-automation", "Коммит", ["git.commit"])]), () => {
      throw new Error("kv is unavailable");
    });
    fireEvent.click((await slot.findAllByRole("button", { name: "Добавить шаг" }))[0]!);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Открыть PR" }));
    expect((await slot.findByRole("alert")).textContent).toContain("kv is unavailable");
  });
});
