// @vitest-environment jsdom
// Папка flow — секция настроек плагина: путь папки, где flow лежат файлами, и
// итог последней сверки с ней. На странице Flow поля папки нет.
import type { ComponentType } from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginNavPanelProps, PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings, FlowSyncState, flowSyncRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const SECTION = "flows-folder";
const synced: FlowSyncState = { dir: "~/.claude/BB Flows", status: { kind: "synced", at: "2026-10-06T12:00:00.000Z" } };

const open = (current: () => FlowSyncState = () => synced, language = "Русский") =>
  renderSlot<PluginSettingsSectionProps, typeof flowSyncRpcContract>(app.settingsSections.find((s) => s.id === SECTION)!, {}, {
    rpc: {
      getFlowSync: current,
      setFlowSyncDir: ({ dir }: { dir: string }) => ({ dir, status: dir === "" ? { kind: "off" } : { kind: "synced", at: "2026-10-06T12:01:00.000Z" } }),
    } as never,
    settings: { language },
  });

describe("секция «Папка flow» в настройках плагина", () => {
  it("называется «Папка flow»", () => {
    expect(app.settingsSections.find((s) => s.id === SECTION)?.title).toBe("Папка flow");
  });

  it("показывает папку и что flow в ней актуальны", async () => {
    const slot = open();
    const field = (await slot.findByRole("textbox", { name: "Папка flow" })) as HTMLInputElement;
    expect(field.value).toBe("~/.claude/BB Flows");
    expect(await slot.findByText("Flow в папке актуальны")).toBeTruthy();
  });

  it("новый путь сохраняется по уходу фокуса", async () => {
    const slot = open();
    const field = await slot.findByRole("textbox", { name: "Папка flow" });
    fireEvent.change(field, { target: { value: "~/Flows" } });
    fireEvent.blur(field);
    await waitFor(() => expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "setFlowSyncDir", input: { dir: "~/Flows" } })));
  });

  it("пустое поле выключает папку: flow хранятся только в bb", async () => {
    const slot = open();
    const field = (await slot.findByRole("textbox", { name: "Папка flow" })) as HTMLInputElement;
    expect(field.placeholder).toBe("Пусто — flow хранятся только в bb");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    await waitFor(() => expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "setFlowSyncDir", input: { dir: "" } })));
    expect(await slot.findByText("Папка не задана — flow хранятся только в bb")).toBeTruthy();
  });

  it("ошибка чтения папки видна текстом", async () => {
    const slot = open(() => ({ dir: "~/F", status: { kind: "error", message: "Code.flow.json: not valid JSON", at: "2026-10-06T12:00:00.000Z" } }));
    expect(await slot.findByText(/Code\.flow\.json: not valid JSON/)).toBeTruthy();
  });

  it("итог сверки обновляется, когда папка поменялась", async () => {
    let state: FlowSyncState = { dir: "~/F", status: { kind: "pending" } };
    const slot = open(() => state);
    expect(await slot.findByText("Читаю папку…")).toBeTruthy();
    state = { dir: "~/F", status: { kind: "error", message: "Review.flow.json: missing", at: "2026-10-06T12:00:00.000Z" } };
    await slot.emitRealtime("flow:sync", {});
    expect(await slot.findByText(/Review\.flow\.json: missing/)).toBeTruthy();
  });

  it("по-английски — без слова sync", async () => {
    const slot = open(undefined, "English");
    const field = (await slot.findByRole("textbox", { name: "Flows folder" })) as HTMLInputElement;
    expect(field.placeholder).toBe("Empty — flows live only in bb");
    expect(await slot.findByText("Flows in the folder are up to date")).toBeTruthy();
  });
});

describe("страница Flow", () => {
  const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "code", name: "Code", stages: [] }] };

  it("под деревом flow нет поля папки", async () => {
    const panel = app.navPanels.find((p) => p.id === "flows")!;
    const slot = renderSlot<PluginNavPanelProps, never>({ component: panel.component as ComponentType<PluginNavPanelProps> }, { subPath: "" }, {
      rpc: { getFlowSettings: () => settings, saveFlowSettings: (i: unknown) => i, getStageCatalog: () => ({ skills: [], executors: [] }), getFlowSync: () => synced } as never,
      settings: { language: "Русский" },
    });
    await slot.findByRole("navigation", { name: "Flow" });
    expect(slot.queryByRole("textbox", { name: /Папка/ })).toBeNull();
    expect(slot.queryByText("Синхронизировано")).toBeNull();
  });
});
