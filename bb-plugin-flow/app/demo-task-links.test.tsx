// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_demo_tasks",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Merge",
    done: ["Бюджет от объёма"],
    pending: [],
    tasks: [
      { key: "flow-byudzhet-brifa-ot-obema-ne-nulem", done: true, note: "модель цены" },
      { key: "BBPL-7", done: false },
    ],
    results: [{ label: "PR #1", target: "https://github.com/e0068/bb-plugins/pull/1" }],
  },
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: demo, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("задачи в демонстрации", () => {
  it("каждая задача — ссылка на её карточку в Tasks+ по ключу или слагу: путь не протухает, когда задача меняет статус", async () => {
    const slot = open();
    const slug = await slot.findByRole("link", { name: "flow-byudzhet-brifa-ot-obema-ne-nulem" });
    expect(slug.getAttribute("href")).toBe("/plugins/tasks-plus/tasks/task/flow-byudzhet-brifa-ot-obema-ne-nulem");
    expect(slot.getByRole("link", { name: "BBPL-7" }).getAttribute("href")).toBe("/plugins/tasks-plus/tasks/task/BBPL-7");
  });
});
