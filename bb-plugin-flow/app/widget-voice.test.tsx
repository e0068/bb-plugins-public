// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief, decisionsRpcContract, voiceRpcContract } from "../shared/contract";
import { installMicrophone, uninstallMicrophone } from "./voice-fakes";

const app = await loadPluginApp(() => import("../app"));

const legacy: DecisionBrief = {
  id: "dec_legacy",
  threadId: "thr_1",
  title: "Бриф прежнего вида",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "budget", kind: "choice", question: "Целевой бюджет", allowOwn: true, options: [
      { id: "low", action: "$8", recommended: false },
      { id: "mid", action: "$15", recommended: true },
    ] },
    { id: "executor", kind: "fork", question: "Кто исполняет?", allowOwn: false, options: [
      { id: "self", action: "Сам", recommended: true, description: "…", cost: "~1M", risks: "…" },
      { id: "pipe", action: "Конвейер", recommended: false, description: "…", cost: "~2M", risks: "…" },
    ] },
  ],
};

const clarify: DecisionBrief = {
  id: "dec_legacy_clarify",
  threadId: "thr_1",
  title: "Уточнение",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "clarify",
  questions: [
    { id: "q", kind: "yesno", question: "Влить сразу?", allowOwn: false, options: [
      { id: "yes", action: "Да", recommended: true },
      { id: "no", action: "Нет", recommended: false },
    ] },
  ],
};

const open = (brief: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof voiceRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: null,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: () => ({ kind: "not_found" }),
        transcribeVoice: () => ({ kind: "transcribed", text: "Привет" }),
      },
    },
  );

const MIC = /^Голосовой ввод/;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  installMicrophone();
});

afterEach(() => {
  cleanup();
  uninstallMicrophone();
  vi.useRealTimers();
});

describe("микрофон в полях брифа прежнего вида", () => {
  it("у своего значения, своего ответа развилки и «Дополнить бриф» есть микрофон", async () => {
    const slot = open(legacy);
    await slot.findByText(legacy.title);
    const fields = slot.getAllByRole("textbox");
    expect(fields).toHaveLength(3);
    expect(slot.getAllByRole("button", { name: MIC })).toHaveLength(fields.length);
  });

  it("у поля уточнения есть микрофон, и надиктованное встаёт в поле", async () => {
    const slot = open(clarify);
    const group = await slot.findByRole("group", { name: "Влить сразу?" });
    fireEvent.click(within(group).getByRole("button", { name: MIC }));
    const stop = await within(group).findByRole("button", { name: "Остановить и распознать" });
    vi.setSystemTime(Date.now() + 2_000);
    fireEvent.click(stop);
    await waitFor(() => expect((within(group).getByRole("textbox") as HTMLInputElement).value).toBe("Привет"));
  });
});
