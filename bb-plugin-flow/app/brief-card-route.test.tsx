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
  id: "dec_route",
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
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => remembered, listProjects: () => ({ kind: "found" as const, projects: [] }),
      },
    },
  );

type Slot = ReturnType<typeof open>;

// Колонка рисуется, только когда в ней есть что выбрать, и появляется по ходу теста: группа ищется на каждое обращение.
const lists = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
  const group = (name: string) => () => within(slot.getByRole("group", { name }));
  return { thread: group("Тред"), tree: group("Рабочее дерево"), branch: group("Ветка") };
};

describe("«Исполнять» — три списка", () => {
  it("в новом треде доступны только ветки, возможные в выбранном дереве", async () => {
    const slot = open({ place: "thread" });
    const { thread, tree, branch } = await lists(slot);
    fireEvent.click(thread().getByRole("button", { name: "В новом треде" }));
    fireEvent.click(tree().getByRole("button", { name: "В новом рабочем дереве" }));
    const enabled = () => branch().getAllByRole("button").filter((b) => !b.hasAttribute("disabled")).map((b) => b.textContent);
    expect(enabled()).toEqual(["Отвести ветку от текущей", "Отвести от origin/main", "Отвести от main"]);
    expect(tree().getAllByRole("button").every((b) => !b.hasAttribute("disabled"))).toBe(true);
  });

  it("запомненный маршрут встаёт при открытии и уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open({ place: "thread", route: { tree: "local", branch: "from-main" } }, sent);
    const { tree, branch } = await lists(slot);
    await waitFor(() => expect(tree().getByRole("button", { name: "В чекауте проекта" }).getAttribute("aria-pressed")).toBe("true"));
    expect(branch().getByRole("button", { name: "Отвести от main" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "thread", route: { tree: "local", branch: "from-main" } });
  });

  it("выбранный в списках новый тред уходит в ответе с деревом и веткой; «в этом треде» маршрута не несёт", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open({ place: "here" }, sent);
    const { thread, tree, branch } = await lists(slot);
    fireEvent.click(thread().getByRole("button", { name: "В новом треде" }));
    fireEvent.click(tree().getByRole("button", { name: "В новом рабочем дереве" }));
    fireEvent.click(branch().getByRole("button", { name: "Отвести от origin/main" }));
    fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ place: "thread", route: { tree: "new", branch: "from-origin-main" } });

    cleanup();
    const quiet: DecisionAnswer[] = [];
    const here = open({ place: "thread", route: { tree: "new", branch: "from-main" } }, quiet);
    const lists2 = await lists(here);
    await waitFor(() => expect(lists2.tree().getByRole("button", { name: "В новом рабочем дереве" }).getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(lists2.thread().getByRole("button", { name: "В этом треде" }));
    fireEvent.click(here.getByRole("button", { name: /^Отправить/ }));
    await waitFor(() => expect(quiet).toHaveLength(1));
    expect(quiet[0]?.place).toBe("here");
    expect(quiet[0]?.route).toBeUndefined();
  });
});
