// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceTasksChanged, onOpenTask, type OpenTaskRequest } from "@bb-plugins/task-bridge";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

/** Статус задачи на доске Tasks+ — тест двигает его, как владелец на доске; `null` — Tasks+ не отвечает. */
let status: string | null = "todo";

beforeEach(() => {
  status = "todo";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (status === null) return new Response("boom", { status: 500 });
      const task = { id: "x", key: "BBPL-7", title: "Живая задача", description: "", status, priority: "none" };
      return new Response(JSON.stringify({ ok: true, result: { task } }), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const demo: DecisionBrief = {
  id: "dec_demo_bridge",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-07T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Merge",
    done: ["Мост"],
    pending: [],
    tasks: [{ key: "BBPL-7", done: false }],
    results: [{ label: "PR #1", target: "https://github.com/e0068/bb-plugins/pull/1" }],
  },
};

const shown = async () => {
  const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: demo, answer: null }), answerBrief: () => ({ kind: "not_found" }) }, openThreadPanel: () => true },
  );
  await slot.findByText("Живая задача");
  const shownStatus = () => slot.container.querySelector("[data-task-card] [data-task-status]")?.getAttribute("data-task-status");
  return { slot, shownStatus };
};

/**
 * Задача из Демонстрации открывается полной вкладкой Tasks+, а не копией Flow на чтение: Flow просит Tasks+ событием
 * окна (packages/task-bridge). Статус карточки следует за доской, пока окно открыто.
 */
describe("задача демонстрации через мост Tasks+", () => {
  it("клик просит Tasks+ открыть задачу в панели треда брифа, и своя вкладка Flow не открывается", async () => {
    const asked: OpenTaskRequest[] = [];
    const off = onOpenTask(window, (request) => {
      asked.push(request);
      return true;
    });
    const { slot } = await shown();

    fireEvent.click(slot.getByRole("button", { name: /Живая задача/ }));
    off();

    expect(asked).toEqual([{ taskKey: "BBPL-7", threadId: "thr_1" }]);
    expect(slot.navigateCalls.some((call) => call.method === "openThreadPanel")).toBe(false);
  });

  it("Tasks+ сообщил о смене задач — карточка показывает новый статус", async () => {
    const { shownStatus } = await shown();
    expect(shownStatus()).toBe("todo");

    status = "done";
    act(() => announceTasksChanged(window));

    await waitFor(() => expect(shownStatus()).toBe("done"));
  });

  it("возврат в окно переспрашивает статус", async () => {
    const { shownStatus } = await shown();

    status = "in_review";
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(shownStatus()).toBe("in_review"));
  });

  it("сбой фонового переспроса оставляет показанную задачу", async () => {
    const { slot, shownStatus } = await shown();

    status = null;
    act(() => announceTasksChanged(window));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(slot.getByText("Живая задача")).toBeTruthy();
    expect(shownStatus()).toBe("todo");
  });
});
