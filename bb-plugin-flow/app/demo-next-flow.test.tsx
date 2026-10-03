// @vitest-environment jsdom
// Демонстрация с рекомендованным flow: в ряду кнопок — ячейка flow с рекомендацией агента, её можно сменить;
// «Отправить» уводит работу в выбранный flow, «Не переходить» возвращает прежние «Продолжить» и комментарий.
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, flowChoiceRpcContract, outcomeRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_next_flow",
  threadId: "thr_1",
  title: "Ответ на вопрос",
  createdAt: "2026-10-03T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: { stage: "demo", final: true, done: ["Ответ дан"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true, nextFlow: "flow-bug" },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const flows = [
  { id: "flow-answer", name: "Answer", stages: 3 },
  { id: "flow-bug", name: "Bug", stages: 9 },
  { id: "flow-code", name: "Code", stages: 14 },
];

const open = (sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract & typeof flowChoiceRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: demo, answer: null }),
        answerBrief: ({ answer }: { answer: DecisionAnswer }) => {
          sent.push(answer);
          return { kind: "not_found" };
        },
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        runOutcomeCommand: () => ({ kind: "sent", created: false }),
        threadFlowChoice: () => ({ flows, selected: "flow-answer" }),
        pickThreadFlow: () => ({ kind: "picked" as const, selected: "flow-answer" }),
        cancelFlow: () => ({ kind: "cancelled" as const }),
      },
    },
  );

describe("Демонстрация с рекомендованным flow", () => {
  it("ячейка flow показывает рекомендацию агента, кнопка — «Отправить»", async () => {
    const slot = open([]);
    expect(await slot.findByRole("button", { name: /Взять в работу.*Bug/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Отправить" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Завершить" })).toBeNull();
  });

  it("«Отправить» уводит работу в рекомендованный flow", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    await slot.findByRole("button", { name: /Взять в работу.*Bug/ });
    fireEvent.click(slot.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.outcome).toEqual({ accepted: false, flow: { id: "flow-bug", name: "Bug" } });
  });

  it("выбранный владельцем flow уходит вместо рекомендованного, с комментарием", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    fireEvent.pointerDown(await slot.findByRole("button", { name: /Взять в работу.*Bug/ }), { button: 0, ctrlKey: false });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Code" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: "только первую находку" } });
    fireEvent.click(slot.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.outcome).toEqual({ accepted: false, note: "только первую находку", flow: { id: "flow-code", name: "Code" } });
  });

  it("«Не переходить» возвращает прежнее «Завершить» без перехода", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    fireEvent.pointerDown(await slot.findByRole("button", { name: /Взять в работу.*Bug/ }), { button: 0, ctrlKey: false });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Не переходить" }));
    fireEvent.click(slot.getByRole("button", { name: "Завершить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.outcome).toEqual({ accepted: true });
  });
});
