// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TASKS_CHANGED_EVENT, requestOpenTask } from "@bb-plugins/task-bridge";

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const app = await loadPluginApp(() => import("../../app"));

afterEach(cleanup);

const renderHeader = (threadId: string) =>
  renderSlot(
    app.threadHeaderActions[0]!,
    { threadId, projectId: "proj_1", isCompactViewport: false },
    { rpc: { tasksForThread: () => ({ tasks: [] }) }, openThreadPanel: () => true },
  );

/**
 * Окно Демонстрации Flow не может открыть вкладку Tasks+ само: SDK пускает
 * плагин только в свои вкладки. Оно просит событием окна, а Tasks+ открывает
 * свою полную задачу в панели того треда, о котором просят.
 */
describe("мост задач в шапке треда", () => {
  it("по просьбе открывает свою вкладку задачи в панели треда", () => {
    const slot = renderHeader("thr_demo");

    expect(requestOpenTask(window, { taskKey: "BBPL-7", threadId: "thr_demo" })).toBe(true);
    expect(slot.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: { actionId: "task", title: "BBPL-7", params: { taskKey: "BBPL-7" } },
    });
  });

  it("просьбу для другого треда оставляет его шапке", () => {
    const slot = renderHeader("thr_other");

    expect(requestOpenTask(window, { taskKey: "BBPL-7", threadId: "thr_demo" })).toBe(false);
    expect(slot.navigateCalls).toEqual([]);
  });

  it("смену задач на доске пересказывает окну", async () => {
    const slot = renderHeader("thr_demo");
    const heard = vi.fn();
    window.addEventListener(TASKS_CHANGED_EVENT, heard);

    await slot.emitRealtime("tasks:changed", { taskId: null, projectId: "board" });

    window.removeEventListener(TASKS_CHANGED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
