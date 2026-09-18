// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { MUTED_BLINK } from "../core/muted-blink";

afterEach(cleanup);

const review = { id: "review", kind: "skill", name: "Ревью", executor: "agent", state: "done", results: [], minutes: 12, cost: 4 };

const code = (live: boolean) => ({ id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", live, results: [], minutes: null, cost: null });

const land = (state: "now" | "fail", live: boolean) => ({
  id: "land",
  kind: "skill",
  name: "Влить и закрыть",
  executor: "self",
  state,
  live,
  results: [],
  minutes: null,
  cost: null,
  automation: { steps: [{ id: "git.merge", label: "Merge the PR", state, error: state === "fail" ? "GitHub: not mergeable" : null }] },
});

const view = (stage: object) => ({ current: (stage as { id: string }).id, done: 1, step: 2, total: 2, planned: null, environmentId: null, stages: [review, stage] });

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

/** Раскрывает полосу и отдаёт всё, что мерцает. */
const pulsing = async (container: HTMLElement): Promise<HTMLElement[]> => {
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  await waitFor(() => expect(container.querySelectorAll("[data-progress-row]")).toHaveLength(2));
  return [...container.querySelectorAll<HTMLElement>("[data-pulse]")];
};

describe("мерцание в полосе этапов — только при живой работе", () => {
  it("этап навыка стоит, агент не работает — в полосе ничего не мерцает", async () => {
    const slot = await mount(view(code(false)));
    expect(await pulsing(slot.container)).toEqual([]);
  });

  it("агент работает на этапе — значок этапа мерцает в шапке и в строке", async () => {
    const slot = await mount(view(code(true)));
    const head = await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(head.querySelector("[data-stage-icon]")!.hasAttribute("data-pulse")).toBe(true);
    await pulsing(slot.container);
    const row = slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")[1]!;
    expect(row.querySelector("[data-stage-icon]")!.hasAttribute("data-pulse")).toBe(true);
  });

  it("идущая автоматизация — молния с контуром на сегменте мерцает", async () => {
    const slot = await mount(view(land("now", true)));
    await pulsing(slot.container);
    const mark = slot.container.querySelectorAll<HTMLElement>("[data-progress-segment]")[1]!.querySelector<HTMLElement>("[data-automation-mark]")!;
    expect(mark.className).toMatch(/ring-2/);
    expect(mark.hasAttribute("data-pulse")).toBe(true);
  });

  it("упавшая автоматизация — сегмент красный, ничего не мерцает", async () => {
    const slot = await mount(view(land("fail", false)));
    const all = await pulsing(slot.container);
    expect(slot.container.querySelectorAll<HTMLElement>("[data-progress-segment]")[1]!.className).toMatch(/bg-destructive/);
    expect(all).toEqual([]);
  });

  it("мерцание — приглушённые кадры, а не яркий pulse хоста", async () => {
    const slot = await mount(view(code(true)));
    const all = await pulsing(slot.container);
    expect(all.length).toBeGreaterThan(0);
    all.forEach((el) => {
      expect(el.getAttribute("class") ?? "").not.toMatch(/animate-pulse/);
      expect(el.style.animation).toContain(MUTED_BLINK);
    });
    expect([...document.querySelectorAll("style")].some((s) => (s.textContent ?? "").includes(`@keyframes ${MUTED_BLINK}`))).toBe(true);
  });
});
