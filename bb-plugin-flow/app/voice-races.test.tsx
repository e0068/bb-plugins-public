// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failureText } from "../core/voice";
import type { DecisionBrief, decisionsRpcContract, voiceRpcContract } from "../shared/contract";
import { FakeMediaRecorder, installMicrophone, uninstallMicrophone } from "./voice-fakes";

const app = await loadPluginApp(() => import("../app"));

const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const brief: DecisionBrief = {
  id: "dec_voice_races",
  threadId: "thr_1",
  title: "Гонки голосового ввода",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: [{ text: "Первый пункт", add: add(1, 2, 0) }, "Второй пункт"] },
  questions: [
    { id: "how", question: "Каким путём?", kind: "fork", allowOwn: false, options: [
      { id: "rpc", action: "RPC", recommended: true, description: "…", add: add(1, 2, 0) },
      { id: "fetch", action: "fetch", recommended: false, description: "…", add: add(1, 2, 0) },
    ] },
  ],
};

type Contract = typeof decisionsRpcContract & typeof voiceRpcContract;

const open = (handlers: Partial<PluginRpcTestHandlers<Contract>> = {}) =>
  renderSlot<PluginMessageDirectiveProps, Contract>(
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
        ...handlers,
      },
    },
  );

type Slot = ReturnType<typeof open>;
const MIC = /^Голосовой ввод/;
const textbox = (scope: ReturnType<typeof within>, name: string) => scope.getByRole("textbox", { name }) as HTMLTextAreaElement;

const startIn = async (scope: ReturnType<typeof within>, name: string) => {
  fireEvent.click(scope.getByRole("button", { name }));
  const stop = await scope.findByRole("button", { name: "Остановить и распознать" });
  vi.setSystemTime(Date.now() + 2_000);
  return stop;
};

const criteria = async (slot: Slot) => within(await slot.findByRole("group", { name: "Готово, когда" }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  uninstallMicrophone();
  vi.useRealTimers();
});

describe("запись не теряет хозяина", () => {
  it("пока идёт запись, добавленные пункты не убираются: номера пунктов не съезжают под записью", async () => {
    installMicrophone();
    const slot = open();
    const list = await criteria(slot);
    fireEvent.change(textbox(list, "Дополнить"), { target: { value: "a" } });
    fireEvent.change(textbox(list, "Дополнить"), { target: { value: "b" } });
    await startIn(list, "Голосовой ввод: Добавленный пункт 2");

    expect((list.getByRole("button", { name: "Убрать добавленный пункт 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(list.getByRole("button", { name: "Остановить и распознать" }));
    await waitFor(() => expect(textbox(list, "Добавленный пункт 2").value).toBe("b Привет"));
    expect(textbox(list, "Добавленный пункт 1").value).toBe("a");
    expect((list.getByRole("button", { name: "Убрать добавленный пункт 1" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("поле ушло из брифа посреди записи — запись отменяется и микрофон освобождается", async () => {
    const mic = installMicrophone();
    const slot = open();
    const list = await criteria(slot);
    fireEvent.change(textbox(list, "Дополнить"), { target: { value: "a" } });
    await startIn(list, "Голосовой ввод: Дополнить");

    fireEvent.change(textbox(list, "Добавленный пункт 1"), { target: { value: "" } });

    await waitFor(() => expect(mic.stopped()).toBe(1));
    expect(list.queryByRole("button", { name: "Остановить и распознать" })).toBeNull();
    expect((list.getAllByRole("button", { name: MIC }) as HTMLButtonElement[]).every((b) => !b.disabled)).toBe(true);
  });

  it("бриф ушёл из ленты посреди записи — микрофон освобождается", async () => {
    const mic = installMicrophone();
    const slot = open();
    await startIn(await criteria(slot), "Голосовой ввод: Пункт 2");
    slot.unmount();
    expect(mic.stopped()).toBe(1);
  });

  it("распознавание, отменённое крестиком, текста в поле не вставляет", async () => {
    installMicrophone();
    let answer: (value: { kind: "transcribed"; text: string }) => void = () => {};
    const slot = open({ transcribeVoice: () => new Promise((resolve) => (answer = resolve)) });
    const list = await criteria(slot);
    fireEvent.click(await startIn(list, "Голосовой ввод: Пункт 2"));
    fireEvent.click(await list.findByRole("button", { name: "Отменить распознавание" }));
    answer({ kind: "transcribed", text: "Поздно" });
    await waitFor(() => expect(textbox(list, "Пункт 2").value).toBe("Второй пункт"));
    await new Promise((r) => setTimeout(r, 10));
    expect(textbox(list, "Пункт 2").value).toBe("Второй пункт");
  });

  it("опустошённый пункт, у которого отменили запись, возвращает исходный текст", async () => {
    installMicrophone();
    const slot = open();
    const list = await criteria(slot);
    const field = textbox(list, "Пункт 2");
    fireEvent.change(field, { target: { value: "" } });
    field.focus();
    await startIn(list, "Голосовой ввод: Пункт 2");
    fireEvent.click(list.getByRole("button", { name: "Отменить запись" }));
    await waitFor(() => expect(textbox(list, "Пункт 2").value).toBe("Второй пункт"));
  });
});

describe("сбой записи не глушит голосовой ввод", () => {
  it("рекордер не стартовал — ошибка у поля, микрофон освобождён, следующая запись идёт", async () => {
    const mic = installMicrophone();
    FakeMediaRecorder.failNextStart = true;
    const slot = open();
    const group = within(await slot.findByRole("group", { name: "Каким путём?" }));
    fireEvent.click(group.getByRole("button", { name: MIC }));

    expect((await group.findByRole("alert")).textContent).toBe(failureText("recording-failed"));
    expect(mic.stopped()).toBe(1);

    fireEvent.click(group.getByRole("button", { name: MIC }));
    expect(await group.findByRole("button", { name: "Остановить и распознать" })).toBeTruthy();
  });

  it("отказ в доступе не трогает набранный текст", async () => {
    installMicrophone({ deny: "NotAllowedError" });
    const slot = open();
    const group = within(await slot.findByRole("group", { name: "Каким путём?" }));
    fireEvent.change(textbox(group, "Свой ответ"), { target: { value: "набранное" } });
    fireEvent.click(group.getByRole("button", { name: MIC }));
    await group.findByRole("alert");
    expect(textbox(group, "Свой ответ").value).toBe("набранное");
  });
});

describe("денежные поля без микрофона", () => {
  it("у своей цели и своего потолка в прогнозе бюджета микрофона нет", async () => {
    installMicrophone();
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /^Бюджет/ }));
    const panel = within(slot.getByRole("group", { name: "Прогноз бюджета" }));
    expect(panel.getByRole("textbox", { name: "Своя цель" })).toBeTruthy();
    expect(panel.queryAllByRole("button", { name: MIC })).toHaveLength(0);
  });
});
