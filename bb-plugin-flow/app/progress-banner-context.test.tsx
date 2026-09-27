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

const fill = (usedTokens: number, windowTokens = 1_000_000, warnTokens = 250_000, alertTokens = 400_000) => ({
  share: Math.min(1, usedTokens / windowTokens),
  usedTokens,
  windowTokens,
  warnTokens,
  alertTokens,
});

const segments = (container: HTMLElement) => [...container.querySelectorAll("[data-context-segment]")] as HTMLElement[];
const fills = (container: HTMLElement) => [...container.querySelectorAll("[data-context-used]")] as HTMLElement[];

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
    const slot = await mount({ ...base, context: fill(163_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const bar = slot.container.querySelector("[data-context-bar]");
    expect(bar).not.toBeNull();
    const cell = bar!.parentElement!;
    expect(cell.querySelector("[data-progress-segment]")).not.toBeNull();
    // Полоса этапов идёт первой, заполненность — второй.
    expect([...cell.children].indexOf(bar!)).toBe(1);
  });

  it("оба порога внутри окна — три отрезка длиной по порогам", async () => {
    const slot = await mount({ ...base, context: fill(163_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(segments(slot.container).map((s) => Number(s.style.flexGrow))).toEqual([0.25, expect.closeTo(0.15, 10), 0.6]);
  });

  it("порог за окном треда не рисует свою границу", async () => {
    const slot = await mount({ ...base, context: fill(100_000, 300_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(segments(slot.container)).toHaveLength(2);
  });

  it("оба порога за окном — один отрезок во всю длину", async () => {
    const slot = await mount({ ...base, context: fill(100_000, 200_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(segments(slot.container)).toHaveLength(1);
    expect(fills(slot.container)[0]!.style.width).toBe("50%");
  });

  it("занятое заливает отрезки слева направо: первый полон, второй наполовину, третий пуст", async () => {
    const slot = await mount({ ...base, context: fill(325_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(fills(slot.container).map((f) => f.style.width)).toEqual(["100%", "50%", "0%"]);
  });

  it("до жёлтого порога — обычный тон во всех отрезках", async () => {
    const slot = await mount({ ...base, context: fill(249_999) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(fills(slot.container).every((f) => f.className.includes("bg-primary"))).toBe(true);
  });

  it("от жёлтого порога в токенах — жёлтая вся заливка, а не только свой отрезок", async () => {
    const slot = await mount({ ...base, context: fill(250_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(fills(slot.container).every((f) => f.className.includes("bg-warning") && !f.className.includes("bg-primary"))).toBe(true);
  });

  it("от красного порога в токенах — красная", async () => {
    const slot = await mount({ ...base, context: fill(400_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(fills(slot.container).every((f) => f.className.includes("bg-destructive"))).toBe(true);
  });

  it("тон меряет токены, а не долю окна: 300k в окне 2M — уже жёлтая", async () => {
    const slot = await mount({ ...base, context: fill(300_000, 2_000_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(fills(slot.container)[0]!.className).toContain("bg-warning");
  });

  it("подсказка называет процент, занятое с окном и оба порога в токенах", async () => {
    const slot = await mount({ ...base, context: fill(163_000, 900_000) });
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const title = slot.container.querySelector("[data-context-bar]")!.getAttribute("title") ?? "";
    expect(title).toContain("18%");
    expect(title).toContain("163k");
    expect(title).toContain("900k");
    expect(title).toContain("Жёлтая с 250k, красная с 400k");
  });

  it("в блоке итога завершённого прогона второй полосы нет", async () => {
    const summary = { startedAt: "2026-09-23T10:00:00.000Z", finishedAt: "2026-09-23T10:30:00.000Z", minutes: 30, wallMinutes: 30, idleMinutes: 0, cost: 1, stages: 3, skipped: 0, executors: [] };
    const slot = await mount({ ...base, context: fill(163_000), finished: true, summary, summaryBriefId: "dec_1" });
    // Завершённый прогон снимает баннер над композером вместе со второй полосой.
    expect(slot.container.querySelector("[data-context-bar]")).toBeNull();
  });
});
