// @vitest-environment jsdom
// Полоса прогона: вложенный flow — одна строка с номером, свёрнутая, пока прогон не внутри неё; его этапы — 2.1, 2.2.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

afterEach(cleanup);

const BRIEF = [{ id: "nested", name: "Brief" }];
const row = (id: string, state: string, patch: Record<string, unknown> = {}) => ({ id, kind: "skill", name: id, executor: "self", state, results: [], minutes: null, cost: null, ...patch });

const view = (inside: boolean) => ({
  current: inside ? "nested.task" : "spec",
  done: 0,
  total: 4,
  planned: null,
  environmentId: "env_1",
  stages: [
    row("plugin", "done", { number: 1 }),
    row("nested.questions", "done", { number: 2, nest: BRIEF }),
    row("nested.task", inside ? "now" : "done", { number: 3, nest: BRIEF }),
    row("spec", inside ? "todo" : "now", { number: 4 }),
  ],
});

const mount = async (progress: unknown) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, threadFiles, setStageInRun: () => ({ kind: "set" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return slot;
};
const rows = (slot: Awaited<ReturnType<typeof mount>>) =>
  [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")].map((r) => [r.querySelector("[data-progress-number]")?.textContent ?? "", r.querySelector("[data-progress-label]")!.textContent]);

describe("вложенный flow в полосе прогона", () => {
  it("прогон вне flow — flow одной свёрнутой строкой с номером, следующий этап — номер после него", async () => {
    const slot = await mount(view(false));
    expect(rows(slot)).toEqual([
      ["1", "plugin"],
      ["2", "Brief"],
      ["3", "spec"],
    ]);
  });

  it("раскрытая строка flow показывает его этапы с номерами через точку", async () => {
    const slot = await mount(view(false));
    fireEvent.click(slot.getByRole("button", { name: /Brief/, expanded: false }));
    expect(rows(slot)).toEqual([
      ["1", "plugin"],
      ["2", "Brief"],
      ["2.1", "nested.questions"],
      ["2.2", "nested.task"],
      ["3", "spec"],
    ]);
  });

  it("прогон внутри flow — его строка раскрыта сама", async () => {
    const slot = await mount(view(true));
    expect(rows(slot).map(([, label]) => label)).toEqual(["plugin", "Brief", "nested.questions", "nested.task", "spec"]);
  });
});
