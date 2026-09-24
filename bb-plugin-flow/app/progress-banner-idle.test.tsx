// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const row = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  kind: "skill",
  name: id,
  executor: "self",
  state: "done",
  results: [],
  number: 1,
  minutes: null,
  wallMinutes: null,
  idleMinutes: null,
  cost: null,
  ...patch,
});

const steps = { steps: [{ id: "git.create-pr", label: "Open a PR", state: "done", error: null }] };

const view = {
  current: null,
  done: 4,
  step: 4,
  total: 4,
  planned: null,
  environmentId: null,
  stages: [
    row("code", { minutes: 7, wallMinutes: 591 }),
    row("publish", { name: "Commit, FF to Main, PR", minutes: 2, wallMinutes: 618, idleMinutes: 616, automation: steps }),
    row("press", { kind: "action", name: "Publish", minutes: 2, wallMinutes: 42, idleMinutes: 40, automation: steps }),
    row("land", { name: "Merge", minutes: 3, wallMinutes: 3, idleMinutes: 0, automation: steps }),
  ],
};

const expanded = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
  (await screen.findByRole("button", { name: /Прогресс flow/ })).click();
  return slot;
};

const titleOf = (slot: Awaited<ReturnType<typeof expanded>>, text: string) =>
  [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes(text))!.querySelector("[data-progress-spent]")?.getAttribute("title");

describe("простой этапа в подсказке строки", () => {
  it("сломанная автоматизация: минуты работы в строке, простой в подсказке", async () => {
    const slot = await expanded();
    const publish = [...slot.container.querySelectorAll("[data-progress-row]")].find((r) => r.textContent?.includes("Commit, FF to Main, PR"))!;
    expect(publish.textContent).toContain("2 м");
    expect(titleOf(slot, "Commit, FF to Main, PR")).toBe("в работе 2 м, сломанной стояла 616 м");
  });

  it("этап Action: в подсказке ожидание нажатия", async () => {
    expect(titleOf(await expanded(), "Publish")).toBe("в работе 2 м, ждал нажатия 40 м");
  });

  it("автоматизация без простоя подсказкой не дублируется", async () => {
    expect(titleOf(await expanded(), "Merge")).toBeNull();
  });

  it("у этапа навыка подсказка прежняя", async () => {
    expect(titleOf(await expanded(), "code")).toBe("в работе 7 м из 591 м");
  });
});
