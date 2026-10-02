// @vitest-environment jsdom
// Жирное `**…**` в тексте брифа показывается жирным, а звёздочек на экране нет.
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_bold",
  threadId: "thr_1",
  title: "Жирное в брифе",
  createdAt: "2026-10-02T00:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "reading", kind: "confirm", allowOwn: false, question: "Правильно понял?", context: "- Строка: номер → **Название** → **Навык**", options: [{ id: "yes", action: "Да", recommended: true }] },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("жирное в тексте брифа", () => {
  it("пояснение вопроса рисует **слово** жирным и без звёздочек", async () => {
    const slot = open();
    const word = await slot.findByText("Название");
    expect(word.tagName).toBe("STRONG");
    expect(slot.container.textContent).not.toContain("**");
  });
});
