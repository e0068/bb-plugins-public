// @vitest-environment jsdom
// Страница Flow прячет свой список, пока такой же список правда виден в левой панели bb, — а не просто пока настройка включена:
// закреплённый в bb другой список тредов, телефон и выключенная настройка оставляют владельца без списка flow нигде.
import type { ComponentType } from "react";
import { cleanup, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
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

const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "default", name: "Default", stages: [builtinStage("criteria", [])] }] };
const rpc = { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never;

const Page = app.navPanels.find((p) => p.id === "flows")!.component as ComponentType<PluginNavPanelProps>;
const Original = () => <div data-testid="bb-threads">треды bb</div>;

const openPage = () => renderSlot<PluginNavPanelProps, never>({ component: Page }, { subPath: "default" }, { rpc, settings: { language: "Русский" } });
const openPanel = (on: boolean) => {
  window.history.pushState({}, "", flowRoute("default"));
  const props: PluginThreadListProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: compact, onNavigate: vi.fn(), searchQuery: "", Original };
  return renderSlot<PluginThreadListProps, never>(app.threadLists[0]!, props, { rpc, settings: { language: "Русский", showFlowsInThreadsPanel: on } });
};
/** Список в самой странице: запрос только внутри неё — панель стоит в том же документе. */
const pageList = (page: ReturnType<typeof openPage>) => within(page.container).queryByRole("navigation", { name: "Flow" });
const pageListShown = (page: ReturnType<typeof openPage>) => within(page.container).findByRole("navigation", { name: "Flow" });

describe("страница Flow рядом со списком в панели тредов", () => {
  it("список стоит в панели — в странице своего списка нет, а редактор на месте", async () => {
    const panel = openPanel(true);
    expect(await panel.findByRole("navigation", { name: "Flow" })).toBeTruthy();
    const page = openPage();
    expect(await page.findByRole("textbox", { name: "Название flow" })).toBeTruthy();
    expect(pageList(page)).toBeNull();
  });

  it("список из панели ушёл — страница возвращает свой", async () => {
    const panel = openPanel(true);
    await panel.findByRole("navigation", { name: "Flow" });
    const page = openPage();
    await page.findByRole("textbox", { name: "Название flow" });
    panel.unmount();
    await waitFor(() => expect(pageList(page)).not.toBeNull());
  });

  it("телефон: список стоит в шторке, а страница за ней сохраняет свой список — шторку закрывают, и выбор flow на месте", async () => {
    compact = true;
    const panel = openPanel(true);
    expect(await panel.findByRole("navigation", { name: "Flow" })).toBeTruthy();
    const page = openPage();
    expect(await pageListShown(page)).toBeTruthy();
  });

  it("список Flow в панели не монтировался совсем — список остаётся в странице", async () => {
    const page = renderSlot<PluginNavPanelProps, never>({ component: Page }, { subPath: "default" }, { rpc, settings: { language: "Русский", showFlowsInThreadsPanel: true } });
    expect(await pageListShown(page)).toBeTruthy();
  });

  it("настройка выключена — панель с тредами, список в странице как был", async () => {
    const panel = openPanel(false);
    expect(await panel.findByTestId("bb-threads")).toBeTruthy();
    expect(await pageListShown(openPage())).toBeTruthy();
  });
});
