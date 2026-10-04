// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { add, report, stagedBrief } from "../core/stages-fixtures";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const reports = [
  report("task", { recommended: true, share: { percent: 10, risk: 0 } }),
  report("spec", { recommended: true, share: { percent: 50, risk: -1 } }),
  report("plan", { recommended: true, share: { percent: 100, risk: 3 } }),
];

const brief: DecisionBrief = {
  ...stagedBrief(reports),
  id: "dec_scope_price",
  revocable: true,
  scope: "- база",
  setup: { stages: reports, criteria: [{ text: "Первый пункт", add: add(6, 10, 0, 30) }, { text: "Второй пункт", add: add(4, 6, 0, 20) }] },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const stageCell = async (slot: Slot, id: string) => {
  await slot.findByRole("group", { name: "Этапы и бюджет" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${id}"]`)!;
};

describe("цена этапа и база следуют за объёмом", () => {
  it("строка этапа показывает долю объёма, снятие пункта её уменьшает", async () => {
    const slot = open();
    expect((await stageCell(slot, "spec")).textContent).toContain("+$5–+$8");
    fireEvent.click(slot.getByRole("button", { name: "Пункт 1 не нужен" }));
    expect((await stageCell(slot, "spec")).textContent).toContain("+$2–+$3");
  });

  it("у заголовка «Готово, когда» — база: сумма оставленных пунктов", async () => {
    const slot = open();
    const criteria = await slot.findByRole("group", { name: "Готово, когда" });
    expect(criteria.textContent).toContain("+$10–16");
    fireEvent.click(within(criteria).getByRole("button", { name: "Пункт 1 не нужен" }));
    expect(criteria.textContent).toContain("+$4–6");
  });

  it("итог — сумма долей этапов от объёма", async () => {
    const slot = open();
    expect((await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelector("[data-total]")!.textContent).toContain("$16–$25.6");
  });
});
