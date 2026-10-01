// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

/** Бриф без этапов: в ряду кнопок одна кнопка бюджета. */
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

describe("кнопка, одна в своём ряду", () => {
  it("кнопка бюджета без соседей растягивается на всю ширину ряда, а не встаёт в клетку сетки", async () => {
    const slot = open();
    const button = await slot.findByRole("button", { name: /^Бюджет/ });
    const cell = button.parentElement!;
    const row = cell.parentElement!;
    expect(row.className).toContain("flex-wrap");
    expect(row.className).not.toMatch(/grid-cols/);
    expect(cell.style.flexGrow).toBe("1");
  });
});
