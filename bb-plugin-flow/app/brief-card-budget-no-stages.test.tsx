// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

/** Бриф без этапов: из нижнего блока у него только бюджет. */
const brief: DecisionBrief = {
  id: "dec_lone",
  threadId: "thr_1",
  title: "Одна кнопка",
  createdAt: "2026-09-30T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: { criteria: [{ text: "Кнопка на всю ширину", add: { target: 2, max: 4, risk: 1 } }] },
  questions: [],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("бриф без этапов", () => {
  it("бюджет — таблица, раскрытая сразу, без кнопки «Бюджет»", async () => {
    const slot = open();
    const table = within(await slot.findByRole("group", { name: "Этапы и бюджет" }));
    expect(slot.queryByRole("button", { name: /^Бюджет/ })).toBeNull();
    expect(table.getByText("Итого")).toBeTruthy();
    expect(table.getByRole("textbox", { name: "Своя цель" })).toBeTruthy();
  });
});
