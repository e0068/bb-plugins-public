// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_artifacts",
  threadId: "thr_1",
  title: "Бриф с артефактами",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "memory/tasks/todo/sl-1.md" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "prototype.html", target: "https://example.com/p.html" } },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
  },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("артефакты в карточке брифа", () => {
  it("отправить можно, не касаясь ни одного артефакта", async () => {
    const slot = open();
    fireEvent.click(within(await slot.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    expect(slot.getByRole("button", { name: "Отправить бриф" }).hasAttribute("disabled")).toBe(false);
  });
});
