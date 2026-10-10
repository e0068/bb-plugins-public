// @vitest-environment jsdom
// «Show the selected thread» на странице Flow: вход в корень страницы открывает flow треда, с которого пришёл владелец.
import { act, cleanup, waitFor } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SELECTED_THREAD_SETTING } from "@bb-plugins/rail-collapse";
import { followSelectedThread } from "@bb-plugins/rail-collapse/selection-dom";

import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

// Владелец пришёл на страницу Flow из треда thr_1; события адреса bb подаёт тест.
let leaveFollow: () => void = () => undefined;
let routeListeners: Array<() => void> = [];
beforeEach(() => {
  window.history.pushState(null, "", "/threads/thr_1");
  leaveFollow = followSelectedThread("flow", {
    window,
    now: () => 0,
    onRouteChange: (listener) => {
      routeListeners.push(listener);
      return () => void (routeListeners = routeListeners.filter((l) => l !== listener));
    },
  });
  window.history.pushState(null, "", "/plugins/flow/flows");
  routeListeners.forEach((l) => l());
});

afterEach(() => {
  cleanup();
  leaveFollow();
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for("bb-plugins.selected-thread.v1")];
});

const settings: FlowSettings = {
  version: 2,
  flows: [
    { id: "default", name: "Default", stages: [] },
    { id: "quick", name: "Quick", stages: [] },
  ],
  minButtonWidth: 170,
  noFlowDescription: "",
};

const open = (subPath: string, enabled: boolean, flowId: string | null) =>
  renderSlot<PluginNavPanelProps>(app.navPanels.find((p) => p.id === "flows")!, { subPath }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), threadFlow: () => ({ flowId }) } as never,
    settings: { language: "Русский", [SELECTED_THREAD_SETTING]: enabled },
  });

/** Обычный клик по строке треда в левой панели bb. */
function pickRow(threadId: string): void {
  const row = document.createElement("a");
  row.dataset.sidebarThreadId = threadId;
  document.body.append(row);
  act(() => row.click());
  row.remove();
}

const toQuick = { method: "toPluginPanel", path: "flows", options: { subPath: "quick", replace: true } };

describe("страница Flow показывает flow выбранного треда", () => {
  it("вход в корень страницы открывает flow треда", async () => {
    const slot = open("", true, "quick");
    await waitFor(() => expect(slot.navigateCalls).toContainEqual(toQuick));
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "threadFlow", input: { threadId: "thr_1" } }));
  });

  it("у треда без своего flow страница остаётся списком, а выбранный кликом такой тред открывается сам", async () => {
    const slot = open("", true, null);
    await waitFor(() => expect(slot.rpcCalls.some((call) => call.method === "threadFlow")).toBe(true));
    expect(slot.navigateCalls).toEqual([]);
    pickRow("thr_2");
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_2" }));
  });

  it("выключенная настройка и адрес flow страницу не уводят", async () => {
    const off = open("", false, "quick");
    const deep = open("default", true, "quick");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([...off.rpcCalls, ...deep.rpcCalls].some((call) => call.method === "threadFlow")).toBe(false);
  });
});
