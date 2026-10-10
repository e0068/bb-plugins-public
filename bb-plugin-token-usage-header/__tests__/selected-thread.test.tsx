// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { SELECTED_THREAD_SETTING } from "@bb-plugins/rail-collapse";
import { followSelectedThread } from "@bb-plugins/rail-collapse/selection-dom";
import { DEFAULT_VIZ_SETTINGS } from "../src/core";

// The owner came from thread thr_1 to the Usage Analytics page; a plain
// object stands in for bb's route events, which this test drives by hand.
let leaveFollow: () => void = () => undefined;
let routeListeners: Array<() => void> = [];
beforeEach(() => {
  window.history.pushState(null, "", "/threads/thr_1");
  leaveFollow = followSelectedThread("token-usage-header", {
    window,
    now: () => 0,
    onRouteChange: (listener) => {
      routeListeners.push(listener);
      return () => void (routeListeners = routeListeners.filter((l) => l !== listener));
    },
  });
  window.history.pushState(null, "", "/plugins/token-usage-header/threads");
  routeListeners.forEach((l) => l());
});

afterEach(() => {
  cleanup();
  leaveFollow();
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for("bb-plugins.selected-thread.v1")];
});

async function openUsagePage(subPath: string, enabled: boolean, sessionId: string | null) {
  const app = await loadPluginApp(() => import("../app"));
  const registration = app.navPanels.find((p) => p.id === "threads-timeline")!;
  return renderSlot<PluginNavPanelProps>(registration, { subPath }, {
    rpc: {
      threadSession: async () => ({ sessionId }),
      threadsTimeline: async () => ({ status: "error", message: "not in this test" }),
      loadVizSettings: async () => DEFAULT_VIZ_SETTINGS,
      saveVizSettings: async () => ({ ok: true as const }),
    } as never,
    settings: { [SELECTED_THREAD_SETTING]: enabled },
  });
}

/** A plain click on a row of bb's threads panel. */
function pickRow(threadId: string): void {
  const row = document.createElement("a");
  row.dataset.sidebarThreadId = threadId;
  document.body.append(row);
  act(() => row.click());
  row.remove();
}

const toSession = {
  method: "toPluginPanel",
  path: "threads",
  options: { subPath: "agent/main/session/sess_1", replace: true },
};

describe("Usage Analytics shows the selected thread", () => {
  it("entered at its root, the page opens the selected thread's session", async () => {
    const slot = await openUsagePage("", true, "sess_1");
    await waitFor(() => expect(slot.navigateCalls).toContainEqual(toSession));
    expect(slot.rpcCalls).toContainEqual(expect.objectContaining({ method: "threadSession", input: { threadId: "thr_1" } }));
  });

  it("with the setting off the feed stays", async () => {
    const slot = await openUsagePage("", false, "sess_1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(slot.rpcCalls.some((call) => call.method === "threadSession")).toBe(false);
  });

  it("a thread without a session leaves the feed as it is on entry, and opens itself when picked", async () => {
    const slot = await openUsagePage("", true, null);
    await waitFor(() => expect(slot.rpcCalls.some((call) => call.method === "threadSession")).toBe(true));
    expect(slot.navigateCalls).toEqual([]);
    pickRow("thr_2");
    await waitFor(() => expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_2" }));
  });
});
