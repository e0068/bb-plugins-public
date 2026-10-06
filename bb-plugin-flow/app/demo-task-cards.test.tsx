// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
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
  createdAt: "2026-10-06T00:00:00.000Z",
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
      { key: "**кривой ключ**", done: false },
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

const shown = async () => {
  const slot = open();
  await slot.findByText("Review");
  const group = (title: string) => slot.getByText(title, { selector: "div" }).parentElement!;
  const cards = (node: HTMLElement) => within(node).queryAllByTestId("bb-markdown").map((card) => card.textContent);
  return { slot, group, cards };
};

/**
 * Задачи Демонстрации — карточки Tasks+ в самом окне двумя группами: «Review» — задачи, чей итог показан и которые
 * станут done, когда владелец примет шаг; «Created» — только заведённые. Статус видно в карточке, подписей нет.
 */
describe("задачи в демонстрации", () => {
  it("задачи с показанным итогом — карточками Tasks+ в группе «Review»", async () => {
    const { group, cards } = await shown();
    expect(cards(group("Review"))).toEqual(['::task{key="flow-byudzhet-brifa-ot-obema-ne-nulem"}']);
  });

  it("только заведённые — в группе «Created»; ключ, из которого директиву не собрать, — текстом", async () => {
    const { group, cards } = await shown();
    const created = group("Created");
    expect(cards(created)).toEqual(['::task{key="BBPL-7"}']);
    expect(within(created).getByText("**кривой ключ**")).toBeTruthy();
  });

  it("у задачи ни подписи, ни отметки закрытия — только карточка", async () => {
    const { slot } = await shown();
    expect(slot.queryByText("модель цены")).toBeNull();
    expect(slot.container.querySelectorAll('[data-demo-task] [data-icon="Check"], [data-demo-task] [data-icon="X"]')).toHaveLength(0);
  });

  it("на страницу Tasks+ вторым окном виджет не ведёт", async () => {
    const { slot } = await shown();
    expect(slot.queryAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/plugins/tasks-plus/"))).toEqual([]);
  });
});
