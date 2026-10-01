// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { threadFiles } from "./file-roots-fixture";

afterEach(cleanup);

const view = {
  current: "code",
  done: 1,
  total: 3,
  planned: null,
  environmentId: "env_1",
  stages: [
    { id: "questions", kind: "questions", name: "Questions", executor: "self", state: "done", results: [], minutes: 3, cost: 0.4 },
    { id: "code", kind: "skill", name: "Реализация", executor: "self", state: "now", results: [], minutes: null, cost: null },
    { id: "review", kind: "skill", name: "Ревью", executor: "self", state: "todo", results: [], minutes: null, cost: null },
    { id: "plan", kind: "skill", name: "План", executor: "self", state: "skip", results: [], minutes: null, cost: null },
  ],
};

const mount = async (progress: unknown = view) => {
  const app = await loadPluginApp(() => import("../app"));
  const customization = app.composerCustomizations.find((c) => c.id === "flow-progress")!;
  const slot = renderSlot(customization.banners![0]!, {}, {
    rpc: { getFlowProgress: () => progress, threadFiles, setStageInRun: () => ({ kind: "set" }) } as never,
    composer: { scope: { kind: "thread", threadId: "thr_1" } },
    settings: { language: "Русский" },
  });
  fireEvent.click(await screen.findByRole("button", { name: /Прогресс flow/ }));
  return { slot, rows: [...slot.container.querySelectorAll<HTMLElement>("[data-progress-row]")] };
};

describe("чекбоксы этапов справа в раскрытом баре", () => {
  it("этап впереди — отмеченный чекбокс, убранный — пустой, пройденный и идущий — без чекбокса", async () => {
    const { rows } = await mount();
    expect(within(rows[0]!).queryByRole("checkbox")).toBeNull();
    expect(rows[0]!.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(within(rows[1]!).queryByRole("checkbox")).toBeNull();
    expect(within(rows[2]!).getByRole("checkbox", { name: "Этап в прогоне: Ревью" }).getAttribute("aria-checked")).toBe("true");
    expect(within(rows[3]!).getByRole("checkbox", { name: "Этап в прогоне: План" }).getAttribute("aria-checked")).toBe("false");
  });

  it("нажатие убирает этап из прогона и сразу показывает пустой квадрат", async () => {
    const { slot, rows } = await mount();
    const box = within(rows[2]!).getByRole("checkbox");
    fireEvent.click(box);
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "setStageInRun")?.input).toEqual({ threadId: "thr_1", stageId: "review", run: false }));
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("нажатие на пустой возвращает этап в прогон", async () => {
    const { slot, rows } = await mount();
    fireEvent.click(within(rows[3]!).getByRole("checkbox"));
    await waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "setStageInRun")?.input).toEqual({ threadId: "thr_1", stageId: "plan", run: true }));
  });

  it("прогон, который ведёт другой тред, отсюда не переключается", async () => {
    const { rows } = await mount({ ...view, carrier: { threadId: "thr_2", title: "Новый тред" } });
    expect(rows.flatMap((row) => within(row).queryAllByRole("checkbox"))).toEqual([]);
  });
});
