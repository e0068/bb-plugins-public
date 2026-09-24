// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { ProgressStage } from "../shared/contract";

afterEach(cleanup);

const row = (id: string, state: string, number: number | null) => ({ id, kind: "skill", name: id, executor: "self", state, results: [], number, minutes: null, wallMinutes: null, cost: null });

const view = {
  current: "code",
  done: 1,
  step: 2,
  total: 3,
  planned: null,
  environmentId: null,
  stages: [row("task", "done", 1), row("prototype", "skip", null), row("code", "now", 2), row("review", "todo", 3)],
};

const mount = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  (await screen.findByRole("button", { name: /Прогресс flow/ })).click();
  return slot;
};

const rowOf = (root: HTMLElement, name: string) => [...root.querySelectorAll<HTMLElement>("[data-progress-row]")].find((r) => r.textContent?.includes(name))!;

/** Строка приглушена целиком — прозрачностью, а не цветом текста: приглушённый цвет темы bb почти не отличается от основного. */
const dimmed = (element: HTMLElement) => /(^|\s)opacity-\d+/.test(element.className);

describe("вычеркнутый из прогона этап приглушён целиком", () => {
  it("в раскрытом баннере строка «не в прогоне» приглушена вся — номер, значок и подпись, а этапы впереди, идущий и сделанный — нет", async () => {
    const slot = await mount();
    expect(dimmed(rowOf(slot.container, "prototype"))).toBe(true);
    for (const name of ["task", "code", "review"]) expect(dimmed(rowOf(slot.container, name))).toBe(false);
  });

  it("строка этапа в блоке итога прогона — та же: вычеркнутая приглушена", async () => {
    await loadPluginApp(() => import("../app"));
    const { Row } = await import("./progress-banner");
    const { container } = render(<Row stage={row("plan", "skip", null) as unknown as ProgressStage} open={() => undefined} />);
    expect(dimmed(rowOf(container, "plan"))).toBe(true);
  });
});
