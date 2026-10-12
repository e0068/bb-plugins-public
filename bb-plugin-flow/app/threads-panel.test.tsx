// @vitest-environment jsdom
// Панель тредов слева: со включённой настройкой на странице Flow в ней стоит список flow вместо тредов bb —
// слот списка тредов отдаёт `Original`, настоящий список тредов, и Flow показывает его везде, где свой список не нужен.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { builtinStage } from "../lib/stage-constants";
import { flowRoute } from "../lib/panel-path";
import type { FlowSettings } from "../shared/contract";

let compact = false;
window.matchMedia = (query: string) =>
  ({
    matches: query === COMPACT_VIEWPORT_QUERY ? compact : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);
beforeEach(() => {
  compact = false;
});

const flow = (id: string, name: string) => ({ id, name, stages: [builtinStage("criteria", [])] });
const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [flow("default", "Default"), flow("quick", "Quick")] };

const Original = () => <div data-testid="bb-threads">треды bb</div>;

const open = (options: { on?: boolean; path?: string }) => {
  window.history.pushState({}, "", options.path ?? flowRoute("default"));
  const registration = app.threadLists[0]!;
  const props: PluginThreadListProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: compact, onNavigate: vi.fn(), searchQuery: "", Original };
  return renderSlot<PluginThreadListProps, never>(registration, props, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский", ...(options.on === false ? {} : { showFlowsInThreadsPanel: true }) },
  });
};

type Slot = ReturnType<typeof open>;
const flowsList = async (slot: Slot) => within(await slot.findByRole("navigation", { name: "Flow" }));

describe("список flow в панели тредов", () => {
  it("Flow регистрирует один список тредов", () => {
    expect(app.threadLists).toHaveLength(1);
  });

  it("с включённой настройкой на странице Flow панель показывает «Без flow», все flow и «Новый flow» вместо тредов", async () => {
    const slot = open({});
    const nav = await flowsList(slot);
    expect(nav.getByRole("button", { name: "Без flow" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "Default" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "Quick" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "Новый flow" })).toBeTruthy();
    expect(slot.queryByTestId("bb-threads")).toBeNull();
  });

  it("настройка выключена — на странице Flow панель показывает треды bb", async () => {
    const slot = open({ on: false });
    expect(await slot.findByTestId("bb-threads")).toBeTruthy();
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
  });

  it("вне страницы Flow панель показывает треды bb, даже когда настройка включена", async () => {
    const slot = open({ path: "/threads/thr_1" });
    expect(await slot.findByTestId("bb-threads")).toBeTruthy();
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
  });

  it("на телефоне шторка на странице Flow показывает список flow вместо тредов", async () => {
    compact = true;
    const slot = open({});
    const nav = await flowsList(slot);
    expect(nav.getByRole("button", { name: "Quick" })).toBeTruthy();
    expect(slot.queryByTestId("bb-threads")).toBeNull();
  });

  it("на телефоне при выключенной настройке шторка остаётся с тредами", async () => {
    compact = true;
    const slot = open({ on: false });
    expect(await slot.findByTestId("bb-threads")).toBeTruthy();
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
  });

  it("на телефоне клик по строке открывает flow на странице", async () => {
    compact = true;
    const slot = open({});
    const nav = await flowsList(slot);
    fireEvent.click(nav.getByRole("button", { name: "Quick" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "quick" } });
  });

  it("открытый на странице flow подсвечен в списке панели", async () => {
    const slot = open({ path: flowRoute("quick") });
    const nav = await flowsList(slot);
    expect(nav.getByRole("button", { name: "Quick" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });

  it("«Без flow» подсвечена, когда страница открыта на ней", async () => {
    const slot = open({ path: flowRoute("none") });
    const nav = await flowsList(slot);
    expect(nav.getByRole("button", { name: "Без flow" }).getAttribute("aria-current")).toBe("page");
  });

  it("клик по строке открывает этот flow на странице", async () => {
    const slot = open({});
    const nav = await flowsList(slot);
    fireEvent.click(nav.getByRole("button", { name: "Quick" }));
    expect(slot.navigateCalls).toContainEqual({ method: "toPluginPanel", path: "flows", options: { subPath: "quick" } });
  });

  it("уход со страницы Flow возвращает в панель треды, возврат — список", async () => {
    const slot = open({});
    await flowsList(slot);
    window.history.pushState({}, "", "/threads/thr_1");
    await waitFor(() => expect(slot.queryByTestId("bb-threads")).not.toBeNull(), { timeout: 2000 });
    expect(slot.queryByRole("navigation", { name: "Flow" })).toBeNull();
    window.history.pushState({}, "", flowRoute("quick"));
    await waitFor(() => expect(slot.queryByRole("navigation", { name: "Flow" })).not.toBeNull(), { timeout: 2000 });
    expect(slot.queryByTestId("bb-threads")).toBeNull();
  });
});
