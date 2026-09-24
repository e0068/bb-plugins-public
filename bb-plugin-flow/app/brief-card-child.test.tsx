// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DispatchPlace, DispatchRoute, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_child",
  threadId: "thr_1",
  title: "Где исполнять",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

const open = (remembered: { place: DispatchPlace; route?: DispatchRoute }, sent: DecisionAnswer[] = []) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: ({ answer }) => (sent.push(answer), { kind: "not_found" }), getDispatchPlace: () => remembered, listProjects: () => ({ kind: "found" as const, projects: [] }) } },
  );

type Slot = ReturnType<typeof open>;

// Колонка рисуется, только когда в ней есть что выбрать, и появляется по ходу теста: группа ищется на каждое обращение.
const lists = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
  const group = (name: string) => () => within(slot.getByRole("group", { name }));
  return { thread: group("Тред"), tree: group("Рабочее дерево"), branch: group("Ветка") };
};

const names = (group: ReturnType<typeof within>) => group.getAllByRole("button").map((b: HTMLElement) => b.textContent ?? "");

describe("«Исполнять» — дочерний тред третьим пунктом", () => {
  it("первая колонка предлагает этот тред, новый и дочерний — каждый со значком", async () => {
    const slot = open({ place: "thread" });
    const { thread, tree, branch } = await lists(slot);
    expect(names(thread())).toEqual(["В этом треде", "В новом треде", "В дочернем треде"]);
    expect(names(tree())).toEqual(["В этом рабочем дереве", "В новом рабочем дереве", "В чекауте проекта"]);
    expect(names(branch())).toEqual(["В текущей ветке", "Отвести ветку от текущей", "Отвести от origin/main", "Отвести от main"]);
    for (const group of [thread(), tree(), branch()]) for (const button of group.getAllByRole("button")) expect(button.querySelector("svg")).not.toBeNull();
  });

  it("выбор дочернего треда уходит в ответе вместе с деревом и веткой", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open({ place: "here" }, sent);
    const { thread, tree, branch } = await lists(slot);
    fireEvent.click(thread().getByRole("button", { name: "В дочернем треде" }));
    fireEvent.click(tree().getByRole("button", { name: "В новом рабочем дереве" }));
    fireEvent.click(branch().getByRole("button", { name: "Отвести ветку от текущей" }));
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "child", route: { tree: "new", branch: "from-current" } });
  });

  it("у дочернего треда дерево и ветка выбираются, как у соседнего", async () => {
    const slot = open({ place: "here" });
    const { thread, tree, branch } = await lists(slot);
    fireEvent.click(thread().getByRole("button", { name: "В дочернем треде" }));
    await waitFor(() => expect(names(tree())).toEqual(["В этом рабочем дереве", "В новом рабочем дереве", "В чекауте проекта"]));
    expect(names(branch())).toEqual(["В текущей ветке", "Отвести ветку от текущей", "Отвести от origin/main", "Отвести от main"]);
  });

  it("запомненный «новый worktree» открывается новым тредом", async () => {
    const slot = open({ place: "worktree" });
    const { thread } = await lists(slot);
    await waitFor(() => expect(thread().getByRole("button", { name: "В новом треде" }).getAttribute("aria-pressed")).toBe("true"));
  });
});
