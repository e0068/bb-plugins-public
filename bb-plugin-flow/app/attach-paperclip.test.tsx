// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

const brief: DecisionBrief = {
  id: "dec_attach_paperclip",
  threadId: "thr_1",
  title: "Скрепка",
  createdAt: "2026-10-21T00:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "how", question: "Каким путём?", kind: "fork", allowOwn: true, options: [
      { id: "a", action: "А", recommended: true, description: "…", cost: "1", risk: "S" },
      { id: "b", action: "Б", recommended: false, description: "…", cost: "1", risk: "S" },
    ] },
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

afterEach(cleanup);

describe("кнопка вложения", () => {
  it("у поля брифа нарисована скрепкой, а не плюсом", async () => {
    const group = within(await open().findByRole("group", { name: "Каким путём?" }));
    const button = group.getByRole("button", { name: "Приложить изображение или файл" });
    expect(button.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Paperclip");
  });
});
