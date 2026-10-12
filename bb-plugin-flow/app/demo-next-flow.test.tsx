// @vitest-environment jsdom
// Демонстрация с рекомендованным flow: в ряду кнопок — кнопки Flow и модели с рекомендацией агента, их можно сменить;
// «Отправить» уводит работу в выбранный flow с его моделью, возврат к текущему flow ничего не отправляет.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, outcomeRpcContract, widgetAgentRpcContract } from "../shared/contract";

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

const opus = { providerId: "claude-code", model: "opus", reasoningLevel: "high" as const };
const sonnet = { providerId: "claude-code", model: "sonnet", reasoningLevel: "medium" as const };
const catalog = {
  current: opus,
  currentFlowId: "flow-answer",
  providers: [{ id: "claude-code", name: "Claude Code", models: [{ model: "opus", name: "Opus", efforts: ["medium" as const, "high" as const], defaultEffort: "high" as const }, { model: "sonnet", name: "Sonnet", efforts: ["medium" as const], defaultEffort: "medium" as const }] }],
  flows: [
    { id: "flow-answer", name: "Answer" },
    { id: "flow-bug", name: "Bug", execution: sonnet },
    { id: "flow-code", name: "Code" },
  ],
};

const open = (sent: DecisionAnswer[]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract & typeof widgetAgentRpcContract>(
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
        widgetAgent: () => catalog,
      },
    },
  );

describe("Демонстрация с рекомендованным flow", () => {
  it("кнопка Flow — широкая, с рекомендацией агента ✦; модель flow предложена; кнопка — «Отправить»", async () => {
    const slot = open([]);
    expect(await slot.findByRole("button", { name: "Flow: Bug" })).toBeTruthy();
    expect(slot.getByRole("button", { name: /Модель: Sonnet/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Отправить" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Завершить" })).toBeNull();
  });

  it("«Отправить» уводит работу в рекомендованный flow с его моделью", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    await slot.findByRole("button", { name: "Flow: Bug" });
    fireEvent.click(slot.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.outcome).toEqual({ accepted: false, flow: { id: "flow-bug", name: "Bug" } });
    expect(sent[0]?.execution).toEqual(sonnet);
  });

  it("выбранный владельцем flow уходит вместо рекомендованного, с комментарием, без чужой модели", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    fireEvent.click(await slot.findByRole("button", { name: "Flow: Bug" }));
    const list = within(await slot.findByRole("group", { name: "Flow" }));
    expect(list.getByRole("button", { name: /Answer.*Сейчас/ })).toBeTruthy();
    expect(list.getByRole("button", { name: /Bug.*предлагает агент/ })).toBeTruthy();
    fireEvent.click(list.getByRole("button", { name: "Code" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: "только первую находку" } });
    fireEvent.click(slot.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.outcome).toEqual({ accepted: false, note: "только первую находку", flow: { id: "flow-code", name: "Code" } });
    expect(sent[0]?.execution).toBeUndefined();
  });

  it("вернуть текущий flow без комментария — отправлять нечего: «Отправить комментарии» выключена, ✦ остаётся у рекомендации", async () => {
    const sent: DecisionAnswer[] = [];
    const slot = open(sent);
    fireEvent.click(await slot.findByRole("button", { name: "Flow: Bug" }));
    const list = within(await slot.findByRole("group", { name: "Flow" }));
    fireEvent.click(list.getByRole("button", { name: /^Answer/ }));
    expect((slot.getByRole("button", { name: "Отправить комментарии" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(slot.getByRole("group", { name: "Flow" })).getByRole("button", { name: /Bug.*предлагает агент/ })).toBeTruthy();
  });
});
