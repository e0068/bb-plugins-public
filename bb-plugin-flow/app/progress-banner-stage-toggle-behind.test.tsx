// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

afterEach(cleanup);

const view = {
  current: "code",
  done: 1,
  total: 2,
  planned: null,
  environmentId: "env_1",
  stages: [
    { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4 },
    { id: "plan", kind: "skill", name: "План", executor: "self", state: "skip", results: [], minutes: null, cost: null },
    { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null },
    { id: "review", kind: "skill", name: "Ревью", executor: "self", state: "todo", results: [], minutes: null, cost: null },
  ],
};

describe("чекбоксы только у этапов впереди прогона", () => {
  it("этап, убранный брифом и уже оставшийся позади идущего, чекбокса не получает", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
    const slot = renderSlot(customization.banners![0]!, {}, { rpc: { getFlowProgress: () => view, threadFiles, setStageInRun: () => ({ kind: "set" }) } as never, composer: { scope: { kind: "thread", threadId: "thr_1" } }, settings: { language: "Русский" } });
    fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
    const rows = [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")];
    expect(within(rows[1]!).queryByRole("checkbox")).toBeNull();
    expect(within(rows[3]!).getByRole("checkbox")).toBeTruthy();
  });
});
