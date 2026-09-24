// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const stages = [
  { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4, number: 1 },
  { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null, number: 2 },
  { id: "demo", kind: "demo", name: "Demonstration", executor: "self", state: "todo", results: [], minutes: null, cost: null, number: 3 },
];

const running = { current: "code", done: 1, step: 2, total: 3, planned: null, environmentId: null, stages, finished: false, summary: null, summaryBriefId: "dec_1" };

const finished = {
  current: null,
  done: 3,
  step: 3,
  total: 3,
  planned: null,
  environmentId: null,
  stages: stages.map((s) => ({ ...s, state: "done" as const })),
  finished: true,
  summary: { startedAt: "2026-09-19T10:00:00.000Z", finishedAt: "2026-09-19T12:00:00.000Z", minutes: 90, wallMinutes: 120, idleMinutes: 30, cost: 12.5, stages: 3, skipped: 0, executors: [] },
  summaryBriefId: "dec_1",
};

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => progress } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

describe("шапка баннера и завершённый прогон", () => {
  it("счёт идёт через косую: сделано из всех этапов прогона", async () => {
    const slot = await mount(running);
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(slot.container.querySelector("[data-progress-count]")?.textContent).toBe("1/3");
  });

  it("значок идущего этапа стоит один раз и слева от полосы, а не на её сегменте", async () => {
    const slot = await mount(running);
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(slot.container.querySelectorAll("[data-stage-mark]")).toHaveLength(0);
    expect(slot.container.querySelectorAll("[data-head-icon]")).toHaveLength(1);
  });

  it("завершённый прогон снимает баннер с композера", async () => {
    const slot = await mount(finished);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slot.container.querySelector("[data-progress-count]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Прогресс flow/ })).toBeNull();
  });
});
