// @vitest-environment jsdom
// Полоса прогона: строка Утверждения и кнопочного этапа — на подложке паузы, идущего этапа — на подсветке текущего.
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const row = (id: string, kind: string, state: string) => ({ id, kind, name: id, executor: "self", state, results: [], minutes: null, cost: null });

const progress = {
  current: "code",
  done: 1,
  total: 5,
  planned: null,
  environmentId: "env_1",
  stages: [row("approve-1", "approve", "done"), row("code", "skill", "now"), row("demo", "demo", "todo"), row("press", "action", "todo"), row("approve-2", "approve", "skip")],
};

const tones = async () => {
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, threadFiles, setStageInRun: () => ({ kind: "set" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")].map((r) => r.dataset.tone ?? null);
};

describe("подложка строк полосы прогона", () => {
  it("Утверждение и кнопочный этап — пауза, идущий — текущий, Демонстрация и вычеркнутое — без подложки", async () => {
    expect(await tones()).toEqual(["pause", "current", null, "pause", null]);
  });
});
