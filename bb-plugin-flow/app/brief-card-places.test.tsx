// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, DispatchPlace, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_places",
  threadId: "thr_1",
  title: "Где исполнять",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

const PROJECTS = { kind: "found" as const, projects: [{ id: "proj_2", name: "Cellular" }] };

const open = (remembered: DispatchPlace) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => { throw new Error("не отправляется"); }, getDispatchPlace: () => ({ place: remembered }), listProjects: () => PROJECTS } },
  );

describe("места исполнения — два", () => {
  it("запомненный в проекте новый worktree открывается как «Новый тред»", async () => {
    const slot = open("worktree");
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(place.textContent).toContain("Новый тред");
    expect(place.textContent).not.toMatch(/worktree/);
  });
});

const columns = async (slot: ReturnType<typeof open>) => {
  fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
  return {
    thread: () => within(slot.getByRole("group", { name: "Тред" })),
    tree: () => slot.queryByRole("group", { name: "Рабочее дерево" }),
    branch: () => slot.queryByRole("group", { name: "Ветка" }),
    disabled: () =>
      ["Тред", "Рабочее дерево", "Ветка"]
        .flatMap((name) => slot.queryAllByRole("group", { name }))
        .flatMap((group) => within(group).getAllByRole("button"))
        .filter((button) => button.hasAttribute("disabled")),
  };
};

describe("в раскрытом выборе видно только возможное", () => {
  it("при «В этом треде» колонок дерева и ветки нет вовсе", async () => {
    const slot = open("here");
    const { thread, tree, branch } = await columns(slot);
    await waitFor(() => expect(thread().getByRole("button", { name: "В этом треде" }).getAttribute("aria-pressed")).toBe("true"));
    expect(tree()).toBeNull();
    expect(branch()).toBeNull();
  });

  it("«Дочерний тред» в первой колонке виден при любом дереве", async () => {
    const slot = open("thread");
    const { thread, tree } = await columns(slot);
    await waitFor(() => within(tree()!).getByRole("button", { name: "В чекауте проекта" }));
    fireEvent.click(within(tree()!).getByRole("button", { name: "В чекауте проекта" }));
    expect(thread().getByRole("button", { name: "В дочернем треде" })).toBeTruthy();
  });

  it("в дереве треда четыре ветки и среди них нет «Без ветки»", async () => {
    const slot = open("thread");
    const { tree, branch } = await columns(slot);
    await waitFor(() => within(tree()!).getByRole("button", { name: "В этом рабочем дереве" }));
    fireEvent.click(within(tree()!).getByRole("button", { name: "В этом рабочем дереве" }));
    expect(within(branch()!).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "В текущей ветке",
      "Отвести ветку от текущей",
      "Отвести от origin/main",
      "Отвести от main",
    ]);
  });

  it("ни один пункт выбора места не выключен", async () => {
    const slot = open("thread");
    const { disabled } = await columns(slot);
    await waitFor(() => expect(slot.getByRole("group", { name: "Ветка" })).toBeTruthy());
    expect(disabled()).toEqual([]);
  });
});
