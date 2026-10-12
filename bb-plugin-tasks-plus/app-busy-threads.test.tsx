// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

const idle = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
const thread = (id: string, workflows: number) =>
  ({ id, projectId: "p", isArchived: false, hasPendingInteraction: false, activity: { ...idle, workflows } }) as unknown as PluginSidebarThread;

function renderReporter(sidebarThreads: Partial<PluginSidebarThreadsState>) {
  const overlay = app.appOverlays.find((entry) => entry.id === "busy-threads");
  return renderSlot({ component: overlay!.component }, {}, { rpc: { reportBusyThreads: () => ({ ok: true }) }, sidebarThreads });
}

const reports = (slot: ReturnType<typeof renderReporter>) =>
  slot.inspection.rpcCalls.filter(({ method }) => method === "reportBusyThreads").map(({ input }) => input);

describe("Tasks+ сообщает серверу треды, занятые фоновой работой", () => {
  it("отдаёт треды с идущим workflow", async () => {
    const slot = renderReporter({ status: "ready", threads: [thread("thr_epic", 1), thread("thr_idle", 0)] });
    await waitFor(() => expect(reports(slot)).toEqual([{ threadIds: ["thr_epic"] }]));
  });

  it("пока сайдбар грузится или упал, ничего не шлёт: пустой список стёр бы занятые треды", async () => {
    const loading = renderReporter({ status: "loading", threads: [] });
    const failed = renderReporter({ status: "error", threads: [] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reports(loading)).toEqual([]);
    expect(reports(failed)).toEqual([]);
  });
});
