// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_own",
  threadId: "thr_1",
  title: "Бриф со своим ответом",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "edits", question: "Какие правки?", kind: "pick", allowOwn: false, options: [
      { id: "a", action: "Правка A", recommended: true, description: "…" },
      { id: "b", action: "Правка B", recommended: false, description: "…" },
    ] },
    { id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: null,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("поле своего ответа растёт по тексту", () => {
  it("в выборе и в «правильно ли я понял» свой ответ держит несколько строк", async () => {
    const slot = open();
    for (const name of ["Какие правки?", "Так?"]) {
      const field = within(await slot.findByRole("group", { name })).getByRole("textbox", { name: "Свой ответ" }) as HTMLTextAreaElement;
      fireEvent.change(field, { target: { value: "Первая строка\nвторая строка" } });
      expect(field.value).toBe("Первая строка\nвторая строка");
    }
  });
});
