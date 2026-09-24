// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const row = (id: string, kind: string, state: string) => ({ id, kind, name: id, executor: "self", state, results: [], minutes: null, cost: null });

const base = {
  current: "code",
  done: 1,
  step: 2,
  total: 3,
  planned: null,
  environmentId: "env_1",
  stages: [row("questions", "questions", "done"), row("code", "skill", "now"), row("review", "skill", "todo")],
};

const fill = (share: number, warnPercent = 25, alertPercent = 40) => ({
  share,
  usedTokens: Math.round(share * 900_000),
  windowTokens: 900_000,
  warnPercent,
  alertPercent,
});

const mount = async (view: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

describe("вторая полоса баннера", () => {
  it("чисел нет — второй полосы нет, а полоса этапов на месте", async () => {
    const slot = await mount(base);
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(slot.container.querySelector("[data-context-bar]")).toBeNull();
    expect(slot.container.querySelectorAll("[data-progress-segment]")).toHaveLength(3);
  });

  it("числа есть — полоса стоит под полосой этапов в той же ячейке", async () => {
    const slot = await mount({ ...base, context: fill(0.18) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const bar = slot.container.querySelector("[data-context-bar]");
    expect(bar).not.toBeNull();
    const cell = bar!.parentElement!;
    expect(cell.querySelector("[data-progress-segment]")).not.toBeNull();
    // Полоса этапов идёт первой, заполненность — второй.
    expect([...cell.children].indexOf(bar!)).toBe(1);
  });

  it("ширина заливки равна доле занятого окна", async () => {
    const slot = await mount({ ...base, context: fill(0.18) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(used.style.width).toBe("18%");
  });

  it("до жёлтого порога — обычный тон", async () => {
    const slot = await mount({ ...base, context: fill(0.24) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(used.className).toContain("bg-primary");
  });

  it("от жёлтого порога — жёлтая", async () => {
    const slot = await mount({ ...base, context: fill(0.25) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(used.className).toContain("bg-warning");
    expect(used.className).not.toContain("bg-primary");
  });

  it("от красного порога — красная", async () => {
    const slot = await mount({ ...base, context: fill(0.4) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(used.className).toContain("bg-destructive");
  });

  it("порог из ответа, а не зашитый: с порогами 50 и 70 треть окна — обычный тон", async () => {
    const slot = await mount({ ...base, context: fill(0.33, 50, 70) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(used.className).toContain("bg-primary");
  });

  it("подсказка называет процент, занятое с окном и оба порога", async () => {
    const slot = await mount({ ...base, context: fill(0.18) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const title = slot.container.querySelector("[data-context-bar]")!.getAttribute("title") ?? "";
    expect(title).toContain("18%");
    expect(title).toContain("162k");
    expect(title).toContain("900k");
    expect(title).toContain("25");
    expect(title).toContain("40");
  });

  it("подпись и цвет меряют одно число: 24,51% подписаны как 25% и уже жёлтые", async () => {
    const slot = await mount({ ...base, context: fill(0.2451) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const bar = slot.container.querySelector("[data-context-bar]")!;
    const used = slot.container.querySelector("[data-context-used]") as HTMLElement;
    expect(bar.getAttribute("title")).toContain("25%");
    expect(used.style.width).toBe("25%");
    expect(used.className).toContain("bg-warning");
  });

  it("в блоке итога завершённого прогона второй полосы нет", async () => {
    const summary = { startedAt: "2026-09-23T10:00:00.000Z", finishedAt: "2026-09-23T10:30:00.000Z", minutes: 30, wallMinutes: 30, idleMinutes: 0, cost: 1, stages: 3, skipped: 0, executors: [] };
    const slot = await mount({ ...base, context: fill(0.18), finished: true, summary, summaryBriefId: "dec_1" });
    // Завершённый прогон снимает баннер над композером вместе со второй полосой.
    expect(slot.container.querySelector("[data-context-bar]")).toBeNull();
  });
});
