// @vitest-environment jsdom
// Пункт критерия до правки — текст с разметкой: жирное без ссылок тоже, а не поле со звёздочками.
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_bold_item",
  threadId: "thr_1",
  title: "Жирное в брифе",
  createdAt: "2026-10-02T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: [{ text: "**Название** стоит первым", add: { target: 1, max: 2, risk: 0, minutes: 5 } }] },
  questions: [],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("жирное в пункте критерия", () => {
  it("пункт с жирным без ссылок до правки показан жирным, а не звёздочками", async () => {
    const slot = open();
    const word = await slot.findByText("Название", { selector: "[data-linked-item] strong" });
    expect(word.closest("[data-linked-item]")?.textContent).toBe("Название стоит первым");
  });
});
