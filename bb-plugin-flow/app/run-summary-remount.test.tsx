// @vitest-environment jsdom
// Итог прогона под брифом на повторном монтировании карточки: пока сервер не
// ответил, на его месте стоит заглушка в высоту прошлого показа — иначе лента
// сжимается на высоту блока, упирается в низ, и хост откидывает владельца к
// последнему сообщению. Ответ сервера снимает заглушку.
import { cleanup, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const brief: DecisionBrief = {
  id: "dec_summary_remount",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-09-29T10:00:00.000Z",
  kind: "brief",
  questions: [],
};

const HEIGHT_KEY = `decisions:summary-height:${brief.id}`;

const frozen = {
  threadId: "thr_1",
  done: 1,
  total: 1,
  planned: { minutes: 60, target: 3, max: 6 },
  environmentId: null,
  flowName: "Разработка",
  summary: {
    startedAt: "2026-09-29T10:00:00.000Z",
    finishedAt: "2026-09-29T11:00:00.000Z",
    minutes: 60,
    wallMinutes: 60,
    idleMinutes: 0,
    cost: 3,
    stages: 1,
    skipped: 0,
    executors: [{ id: "self", kind: "self", name: "self", stages: 1, cost: 3 }],
  },
  stages: [{ id: "task", kind: "skill", name: "Задача", executor: "self", state: "done", results: [], minutes: 60, cost: 3, number: 1 }],
};

/** Ответ, который не приходит никогда: сервер ещё думает. */
const pending = () => new Promise<never>(() => undefined);

const mount = (getRunSummary: () => unknown) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), getRunSummary, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }) } as never, settings: { language: "Русский" } },
  );

const placeholder = (slot: { container: HTMLElement }) => slot.container.querySelector<HTMLElement>("[data-run-summary-placeholder]");

describe("итог прогона, смонтированный заново", () => {
  it("пока сервер не ответил, держит место в высоту прошлого показа", () => {
    window.localStorage.setItem(HEIGHT_KEY, "300");
    const slot = mount(pending);
    expect(placeholder(slot)?.style.minHeight).toBe("300px");
  });

  it("ответ без итога снимает заглушку", async () => {
    window.localStorage.setItem(HEIGHT_KEY, "300");
    const slot = mount(() => null);
    await waitFor(() => expect(placeholder(slot)).toBeNull());
  });

  it("сбой запроса снимает заглушку", async () => {
    window.localStorage.setItem(HEIGHT_KEY, "300");
    const slot = mount(() => Promise.reject(new Error("offline")));
    await waitFor(() => expect(placeholder(slot)).toBeNull());
  });

  it("итог, показанный впервые, места заранее не держит", () => {
    const slot = mount(pending);
    expect(placeholder(slot)).toBeNull();
  });

  it("вставший итог запоминает свою высоту", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ height: 320.2 } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly report: ResizeObserverCallback) {}
        observe(target: Element) {
          this.report([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const slot = mount(() => frozen);
    await waitFor(() => expect(slot.container.querySelector("[data-run-summary]")).not.toBeNull());
    await waitFor(() => expect(window.localStorage.getItem(HEIGHT_KEY)).toBe("320"));
  });
});
