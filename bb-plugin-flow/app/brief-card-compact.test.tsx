// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DispatchPlace, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_compact",
  threadId: "thr_1",
  title: "Компактация перед ответом",
  createdAt: "2026-09-24T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [],
};

const open = (remembered: DispatchPlace, sent: DecisionAnswer[] = []) =>
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
        getDispatchPlace: () => ({ place: remembered }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
      },
    },
  );

type Slot = ReturnType<typeof open>;

const expand = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: /^Исполнять/ }));
  return {
    thread: () => within(slot.getByRole("group", { name: "Тред" })),
    context: () => slot.queryByRole("group", { name: "Контекст" }),
  };
};

const send = async (slot: Slot, sent: DecisionAnswer[]) => {
  fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("компактация перед ответом — только в этом треде", () => {
  it("при «В этом треде» есть колонка «Контекст», и открывается она на «Как есть»", async () => {
    const slot = open("here");
    const { context } = await expand(slot);
    await waitFor(() => expect(context()).not.toBeNull());
    const buttons = within(context()!).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Как есть", "Сперва компактировать тред"]);
    expect(within(context()!).getByRole("button", { name: "Как есть" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("при новом треде, дочернем и другом проекте колонки «Контекст» нет", async () => {
    const slot = open("thread");
    const { thread, context } = await expand(slot);
    await waitFor(() => expect(thread().getByRole("button", { name: "В новом треде" }).getAttribute("aria-pressed")).toBe("true"));
    expect(context()).toBeNull();
    fireEvent.click(thread().getByRole("button", { name: "В дочернем треде" }));
    expect(context()).toBeNull();
  });

  it("выбранная компактация видна в ячейке и уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open("here", sent);
    const { context } = await expand(slot);
    await waitFor(() => expect(context()).not.toBeNull());
    fireEvent.click(within(context()!).getByRole("button", { name: "Сперва компактировать тред" }));
    expect(slot.getByRole("button", { name: /^Исполнять/ }).textContent).toContain("В этом треде · компактировать");
    const answer = await send(slot, sent);
    expect(answer).toMatchObject({ place: "here", compact: true });
  });

  it("без выбора ответ компактации не несёт", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open("here", sent);
    await slot.findByRole("button", { name: /^Исполнять/ });
    const answer = await send(slot, sent);
    expect(answer.compact).toBeUndefined();
  });

  it("компактация, выбранная до ухода в новый тред, с ним не уезжает", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open("here", sent);
    const { thread, context } = await expand(slot);
    await waitFor(() => expect(context()).not.toBeNull());
    fireEvent.click(within(context()!).getByRole("button", { name: "Сперва компактировать тред" }));
    fireEvent.click(thread().getByRole("button", { name: "В новом треде" }));
    const answer = await send(slot, sent);
    expect(answer.place).toBe("thread");
    expect(answer.compact).toBeUndefined();
  });
});
