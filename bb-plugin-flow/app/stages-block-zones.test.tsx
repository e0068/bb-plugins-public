// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { add, planner, report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const fresh = stagedBrief([report("plan", { add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } })]);

const open = (brief: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

const planCell = async (slot: ReturnType<typeof open>) => {
  await slot.findByRole("group", { name: "Ответ на бриф" });
  return within(slot.container.querySelector<HTMLElement>(`[data-stage="plan"]`)!);
};

describe("ячейка невыполненного этапа — две зоны", () => {
  it("левая зона — галочка вместе с названием этапа: клик по названию включает этап в прогон", async () => {
    const slot = open(fresh);
    const cell = await planCell(slot);
    const toggle = cell.getByRole("button", { name: /в ближайший прогон/ });
    expect(within(toggle).getByText("План")).toBeTruthy();
    const before = toggle.getAttribute("aria-pressed");
    fireEvent.click(within(toggle).getByText("План"));
    expect(toggle.getAttribute("aria-pressed")).not.toBe(before);
    expect(slot.queryByRole("group", { name: "План: исполнитель" })).toBeNull();
  });

  it("правая зона — отдельная кнопка шеврона: она раскрывает список, но этап не переключает", async () => {
    const slot = open(fresh);
    const cell = await planCell(slot);
    const toggle = cell.getByRole("button", { name: /в ближайший прогон/ });
    const expand = cell.getByRole("button", { name: "План" });
    expect(toggle.contains(expand)).toBe(false);
    expect(expand.contains(toggle)).toBe(false);
    expect(within(expand).queryByText("План")).toBeNull();
    const before = toggle.getAttribute("aria-pressed");
    fireEvent.click(expand);
    expect(slot.getByRole("group", { name: "План: исполнитель" })).toBeTruthy();
    expect(toggle.getAttribute("aria-pressed")).toBe(before);
  });
});
