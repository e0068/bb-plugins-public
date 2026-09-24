// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DispatchRoute, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_projects",
  threadId: "thr_1",
  title: "Куда исполнять",
  createdAt: "2026-09-18T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

type Projects = { kind: "found"; projects: Array<{ id: string; name: string }> } | { kind: "unavailable" };

const TWO: Projects = { kind: "found", projects: [{ id: "proj_2", name: "Cellular" }, { id: "proj_3", name: "Shader Lab" }] };

const open = (projects: Projects | "pending" | (() => Projects), sent: DecisionAnswer[] = [], remembered?: DispatchRoute) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => (remembered === undefined ? { place: "thread" as const } : { place: "other" as const, route: remembered }),
        listProjects: projects === "pending" ? () => new Promise<Projects>(() => undefined) : typeof projects === "function" ? projects : () => projects,
      },
    },
  );

type Slot = ReturnType<typeof open>;

const lists = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
  return {
    cell: await slot.findByRole("button", { name: /^Исполнять/ }),
    thread: () => within(slot.getByRole("group", { name: "Тред" })),
    tree: () => within(slot.getByRole("group", { name: "Рабочее дерево" })),
    project: () => within(slot.getByRole("group", { name: "Проект" })),
  };
};

describe("отправка работы в другой проект", () => {
  it("«В другом проекте» стоит в первой колонке, а вторая остаётся про рабочие деревья", async () => {
    const slot = open(TWO);
    const { thread, tree, project } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В другом проекте" }));
    fireEvent.click(thread().getByRole("button", { name: "В другом проекте" }));
    expect(tree().getAllByRole("button").map((b) => b.textContent)).toEqual(["В новом рабочем дереве", "В чекауте проекта"]);
    expect(project().getAllByRole("button").map((b) => b.textContent)).toEqual(["Cellular", "Shader Lab"]);
    expect(slot.queryByRole("group", { name: "Ветка" })).toBeNull();
  });

  it("выбранные проект и дерево видны в ячейке «Исполнять» и уходят в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(TWO, sent);
    const { cell, thread, tree, project } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В другом проекте" }));
    fireEvent.click(thread().getByRole("button", { name: "В другом проекте" }));
    fireEvent.click(project().getByRole("button", { name: "Shader Lab" }));
    fireEvent.click(tree().getByRole("button", { name: "В чекауте проекта" }));
    expect(cell.textContent).toContain("Shader Lab");
    expect(cell.textContent).toContain("чекаут проекта");
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "other", route: { tree: "local", branch: "none", projectId: "proj_3" } });
  });

  it("щелчок по «В другом проекте» сразу берёт первый проект: маршрут без проекта невозможен", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(TWO, sent);
    const { thread, project } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В другом проекте" }));
    fireEvent.click(thread().getByRole("button", { name: "В другом проекте" }));
    expect(project().getByRole("button", { name: "Cellular" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "other", route: { tree: "new", branch: "none", projectId: "proj_2" } });
  });

  it("запомненный маршрут сводится с местом: показанное дерево — то, что уедет в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    // Место «в другом проекте» с деревом этого треда собрать нельзя, но такая пара может прийти из памяти проекта.
    const slot = open(TWO, sent, { tree: "same", branch: "current", projectId: "proj_3" });
    const { tree } = await lists(slot);
    await waitFor(() => expect(tree().getByRole("button", { name: "В новом рабочем дереве" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "other", route: { tree: "new", branch: "none", projectId: "proj_3" } });
  });

  it("сбой списка не даёт выбрать чужой проект: пункта в первой колонке нет", async () => {
    const slot = open({ kind: "unavailable" });
    const { thread } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В новом треде" }));
    expect(thread().queryByRole("button", { name: "В другом проекте" })).toBeNull();
  });

  it("запомненный чужой проект при сбое списка показывает ошибку и «Повторить», а не исчезает", async () => {
    let answer: Projects = { kind: "unavailable" };
    const slot = open(() => answer, [], { tree: "new", branch: "none", projectId: "proj_2" });
    const { thread, project } = await lists(slot);
    await waitFor(() => expect(thread().getByRole("button", { name: "В другом проекте" }).getAttribute("aria-pressed")).toBe("true"));
    expect(project().getByText("Не удалось получить список проектов")).toBeTruthy();
    answer = TWO;
    fireEvent.click(project().getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(project().getByRole("button", { name: "Cellular" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("пока список грузится, выбрать чужой проект нечем", async () => {
    const slot = open("pending");
    const { thread } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В новом треде" }));
    expect(thread().queryByRole("button", { name: "В другом проекте" })).toBeNull();
  });

  it("проект в bb один — пункта «В другом проекте» нет", async () => {
    const slot = open({ kind: "found", projects: [] });
    const { thread } = await lists(slot);
    await waitFor(() => thread().getByRole("button", { name: "В новом треде" }));
    expect(thread().queryByRole("button", { name: "В другом проекте" })).toBeNull();
  });
});
