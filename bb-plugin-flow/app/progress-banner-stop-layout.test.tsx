// @vitest-environment jsdom
// BBPL-985: «Стоп» стоит по центру строки шапки баннера, шеврон не прилипает к правому краю.
// jsdom не считает раскладку, поэтому обещание проверяется по тому, что её задаёт: выравниванием в ряду и отступами.
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const running = {
  current: "land",
  done: 1,
  step: 2,
  total: 2,
  planned: null,
  environmentId: null,
  stages: [
    { id: "review", kind: "skill", name: "Ревью", executor: "self", state: "done", results: [], minutes: 12, cost: 4 },
    { id: "land", kind: "skill", name: "Commit, PR", executor: "self", state: "now", live: true, results: [], minutes: null, cost: null, automation: { stopping: false, stopped: false, steps: [] } },
  ],
};

const mount = async () => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  return renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => running, retryAutomation: () => ({ started: true }), stopAutomation: () => ({ started: true }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
};

describe("шапка баннера: «Стоп» и шеврон на своих местах", () => {
  it("«Стоп» выровнена по центру строки шапки, а не по её верху", async () => {
    const slot = await mount();
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const stop = slot.container.querySelector<HTMLElement>("[data-stop-button]")!;
    expect(stop.classList.contains("self-center")).toBe(true);
  });

  it("шеврон отступает от правого края баннера и не получает левого отступа кнопки по умолчанию", async () => {
    const slot = await mount();
    await screen.findByRole("button", { name: /Прогресс flow/ });
    const chevron = slot.container.querySelector<HTMLElement>("button[aria-hidden='true']")!;
    expect(chevron.classList.contains("pr-3")).toBe(true);
    expect(chevron.classList.contains("pl-0")).toBe(true);
    expect(chevron.classList.contains("w-auto")).toBe(true);
  });
});
