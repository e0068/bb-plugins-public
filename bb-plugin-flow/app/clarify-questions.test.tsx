// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const clarifyFork: DecisionBrief = {
  id: "dec_clarify_fork",
  threadId: "thr_1",
  title: "Вид списка",
  createdAt: "2026-10-12T12:00:00.000Z",
  kind: "clarify",
  questions: [
    { id: "ui", kind: "fork", question: "Панель или поповер?", allowOwn: false, options: [
      { id: "panel", action: "Панель", recommended: true, description: "Не перекрывает ленту" },
      { id: "pop", action: "Поповер", recommended: false, description: "Перекрывает соседей" },
    ] },
  ],
};

const props = (id: string): PluginMessageDirectiveProps => ({
  attributes: { id },
  source: `::decision{id="${id}"}`,
  message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
  openWorkspaceFile: null,
});

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(app.messageDirectives[0]!, props(clarifyFork.id), {
    rpc: {
      getBrief: () => ({ kind: "found", brief: clarifyFork, answer: null }),
      answerBrief: ({ answer }) => ({ kind: "accepted", record: { answer, messageId: "msg_1", answeredAt: "2026-10-12T12:05:00.000Z" } }),
    },
  });

describe("уточнение с развилкой в сообщении", () => {
  it("рисует варианты с их описаниями, а не одну строку да/нет", async () => {
    const slot = open();
    expect(await slot.findByText("Не перекрывает ленту")).toBeTruthy();
    expect(slot.getByText("Перекрывает соседей")).toBeTruthy();
  });

  it("выбор варианта и отправка отдают агенту ответ на развилку", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /^Поповер/ }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить ответы" }));
    await waitFor(() => expect(slot.rpcCalls.filter((c) => c.method === "answerBrief")).toHaveLength(1));
    expect(slot.rpcCalls.find((c) => c.method === "answerBrief")?.input).toMatchObject({ answer: { answers: [{ questionId: "ui", optionIds: ["pop"] }] } });
  });
});
