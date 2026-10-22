// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentTurn, DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, turnRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const clarify: DecisionBrief = {
  id: "dec_clarifycompact",
  threadId: "thr_1",
  title: "Какой цвет взять?",
  createdAt: "2026-10-21T10:00:00.000Z",
  kind: "clarify",
  questions: [
    {
      id: "color",
      kind: "fork",
      question: "Какой цвет?",
      allowOwn: false,
      options: [
        { id: "red", action: "Красный", recommended: true, description: "Как в макете." },
        { id: "blue", action: "Синий", recommended: false, description: "Как в старой версии." },
      ],
    },
  ],
};

/** Тред в зоне предвыбора сжатия; ход агента отдаёт `turn()` — его можно сменить посреди теста. */
const open = (turn: () => AgentTurn, sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof turnRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: clarify.id },
      source: `::decision{id="${clarify.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: clarify, answer: null }),
        answerBrief: ({ answer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" as const, compact: true }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        agentTurn: () => ({ turn: turn() }),
        ...({ threadFiles } as object),
      },
    },
  );

type Slot = ReturnType<typeof open>;

const placeCell = (slot: Slot) => slot.findByRole("button", { name: /^Исполнять/ });

const answerAndSend = async (slot: Slot, sent: DecisionAnswer[]) => {
  fireEvent.click(await slot.findByRole("button", { name: /Красный/ }));
  fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
  await waitFor(() => expect(sent).toHaveLength(1));
  return sent[0]!;
};

describe("«Сжать тред» на уточнении", () => {
  it("пока агент работает, сжатие не предлагается и не уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(() => "running", sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде"));
    expect((await placeCell(slot)).textContent).not.toContain("компактировать");
    fireEvent.click(await placeCell(slot));
    expect(slot.queryByRole("group", { name: "Контекст" })).toBeNull();
    expect((await answerAndSend(slot, sent)).compact).toBeUndefined();
  });

  it("агент закончил ход — сжатие предлагается по зоне контекста и уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(() => "ended", sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    expect(await answerAndSend(slot, sent)).toMatchObject({ compact: true });
  });

  it("ход кончился, пока уточнение открыто, — сжатие появляется без перезагрузки", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(() => "running", sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("В этом треде"));
    await slot.emitRealtime("decisions:turn", { threadId: "thr_1", turn: "ended" });
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    fireEvent.click(await placeCell(slot));
    expect(within(await slot.findByRole("group", { name: "Контекст" })).getByRole("button", { name: "Сперва компактировать тред" })).toBeTruthy();
  });

  it("начался новый ход — сжатие пропадает и не уходит в ответе", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(() => "ended", sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    await slot.emitRealtime("decisions:turn", { threadId: "thr_1", turn: "running" });
    await waitFor(async () => expect((await placeCell(slot)).textContent).not.toContain("компактировать"));
    expect((await answerAndSend(slot, sent)).compact).toBeUndefined();
  });

  it("смена хода в чужом треде карточку не трогает", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(() => "ended", sent);
    await waitFor(async () => expect((await placeCell(slot)).textContent).toContain("компактировать"));
    await slot.emitRealtime("decisions:turn", { threadId: "thr_other", turn: "running" });
    expect((await placeCell(slot)).textContent).toContain("компактировать");
  });
});
