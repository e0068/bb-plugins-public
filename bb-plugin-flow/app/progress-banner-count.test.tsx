// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const row = (id: string, kind: string, state: string) => ({ id, kind, name: id, executor: "self", state, results: [], minutes: null, cost: null });

const view = {
  current: "code",
  done: 4,
  step: 5,
  total: 6,
  planned: { minutes: 30, target: 8.5, max: 16 },
  environmentId: "env_1",
  stages: [
    row("questions", "questions", "done"),
    row("criteria", "criteria", "done"),
    row("select", "select", "done"),
    row("task", "skill", "done"),
    row("prototype", "skill", "skip"),
    row("demo", "demo", "skip"),
    row("code", "skill", "now"),
    row("review", "skill", "skip"),
    row("testing", "skill", "todo"),
  ],
};

const mount = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
};

describe("свёрнутый баннер прогресса", () => {
  it("«N из M» — номер текущего этапа среди этапов прогона, сегменты — только этапы прогона; план времени и бюджета на месте", async () => {
    const slot = await mount();
    const head = await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(within(head).getByText("5 из 6")).toBeTruthy();
    expect(head.getAttribute("aria-label")).toContain("5 из 6");
    expect(within(head).getByText("30 м")).toBeTruthy();
    expect(within(head).getByText("$8.5–16")).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-progress-segment]")).toHaveLength(6);
  });

  it("свёрнутый показывает иконку текущего этапа, но не его название", async () => {
    await mount();
    const head = await screen.findByRole("button", { name: /Прогресс flow/ });
    expect(head.querySelector('[data-icon="Diamond"]')).not.toBeNull();
    expect(head.textContent).not.toContain("code");
  });
});
