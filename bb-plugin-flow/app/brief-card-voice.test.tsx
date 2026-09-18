// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { failureText, unsupportedText } from "../core/voice";
import type { AnswerRecord, DecisionBrief, decisionsRpcContract, voiceRpcContract } from "../shared/contract";
import { readStoredDraft } from "./draft-storage";
import { FakeMediaRecorder, installMicrophone, installNoMicrophone, uninstallMicrophone } from "./voice-fakes";

const app = await loadPluginApp(() => import("../app"));

const brief: DecisionBrief = {
  id: "dec_voice",
  threadId: "thr_1",
  title: "Голосовой ввод",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true },
      { id: "prototype", name: "HTML-прототип", state: "missing", recommended: false },
      { id: "spec", name: "Спецификация", state: "missing", recommended: false },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    criteria: ["Микрофон в каждом поле", "Текст встаёт на место курсора"],
  },
  questions: [
    { id: "how", question: "Каким путём?", kind: "fork", allowOwn: false, options: [
      { id: "rpc", action: "RPC", recommended: true, description: "…", cost: "~1M", risk: "S" },
      { id: "fetch", action: "fetch", recommended: false, description: "…", cost: "~1M", risk: "L" },
    ] },
    { id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] },
  ],
};

type Contract = typeof decisionsRpcContract & typeof voiceRpcContract;
type Handlers = PluginRpcTestHandlers<Contract>;

const open = (handlers: Partial<Handlers> = {}) =>
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

const MIC = /^Голосовой ввод/;
const second = () => vi.setSystemTime(Date.now() + 2_000);

const ownField = async (slot: ReturnType<typeof open>, question: string) =>
  within(await slot.findByRole("group", { name: question })).getByRole("textbox", { name: "Свой ответ" }) as HTMLTextAreaElement;

const record = async (slot: ReturnType<typeof open>, group: HTMLElement) => {
  fireEvent.click(within(group).getByRole("button", { name: MIC }));
  const stop = await within(group).findByRole("button", { name: "Остановить и распознать" });
  second();
  return stop;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  cleanup();
  uninstallMicrophone();
  vi.useRealTimers();
});

describe("микрофон в полях брифа", () => {
  it("у каждого поля ввода открытого брифа есть своя кнопка микрофона", async () => {
    installMicrophone();
    const slot = open();
    await slot.findByRole("group", { name: "Каким путём?" });
    const fields = slot.getAllByRole("textbox");
    // «Свой ответ» у развилки и подтверждения, два пункта, «Дополнить», «Дополнить бриф».
    expect(fields).toHaveLength(6);
    expect(slot.getAllByRole("button", { name: MIC })).toHaveLength(fields.length);
  });

  it("клик по микрофону запускает запись: вместо поля полоса с «Отменить запись» и «Остановить и распознать»", async () => {
    installMicrophone();
    const slot = open();
    const group = await slot.findByRole("group", { name: "Каким путём?" });
    fireEvent.click(within(group).getByRole("button", { name: MIC }));

    expect(await within(group).findByRole("button", { name: "Отменить запись" })).toBeTruthy();
    expect(within(group).getByRole("button", { name: "Остановить и распознать" })).toBeTruthy();
    expect(within(group).queryByRole("textbox", { name: "Свой ответ" })).toBeNull();
    expect(FakeMediaRecorder.instances[0]?.state).toBe("recording");
  });

  it("распознанный текст встаёт на место курсора в том же поле и попадает в черновик", async () => {
    installMicrophone();
    const slot = open();
    const field = await ownField(slot, "Каким путём?");
    fireEvent.change(field, { target: { value: "до после" } });
    field.focus();
    field.setSelectionRange(3, 3);

    fireEvent.click(await record(slot, slot.getByRole("group", { name: "Каким путём?" })));

    const filled = await waitFor(async () => {
      const next = await ownField(slot, "Каким путём?");
      expect(next.value).toBe("до Привет после");
      return next;
    });
    expect(document.activeElement).toBe(filled);
    expect(readStoredDraft(brief.id)?.entries.how?.own).toBe("до Привет после");
    const call = slot.rpcCalls.find((c) => c.method === "transcribeVoice")?.input as { audio: string; mimeType: string; prompt?: string };
    expect(call.audio).toBe(btoa("voice"));
    expect(call.mimeType).toBe("audio/webm");
    expect(call.prompt).toBe("до");
    expect(slot.getByRole("group", { name: "Так?" }).querySelector("textarea")?.value).toBe("");
  });

  it("микрофон пункта «Готово, когда» дописывает надиктованное к этому пункту", async () => {
    installMicrophone();
    const slot = open();
    const criteria = await slot.findByRole("group", { name: "Готово, когда" });
    fireEvent.click(within(criteria).getByRole("button", { name: "Голосовой ввод: Пункт 2" }));
    const stop = await within(criteria).findByRole("button", { name: "Остановить и распознать" });
    second();
    fireEvent.click(stop);
    await waitFor(() => expect((within(criteria).getByRole("textbox", { name: "Пункт 2" }) as HTMLTextAreaElement).value).toBe("Текст встаёт на место курсора Привет"));
    expect((within(criteria).getByRole("textbox", { name: "Пункт 1" }) as HTMLTextAreaElement).value).toBe("Микрофон в каждом поле");
  });

  it("отмена записи не меняет поле и не зовёт распознавание", async () => {
    const mic = installMicrophone();
    const slot = open();
    const field = await ownField(slot, "Каким путём?");
    fireEvent.change(field, { target: { value: "как было" } });
    const group = slot.getByRole("group", { name: "Каким путём?" });
    await record(slot, group);

    fireEvent.click(within(group).getByRole("button", { name: "Отменить запись" }));

    expect((await ownField(slot, "Каким путём?")).value).toBe("как было");
    expect(slot.rpcCalls.some((c) => c.method === "transcribeVoice")).toBe(false);
    expect(mic.stopped()).toBe(1);
  });

  it("сбой распознавания — строка ошибки под полем, набранный текст на месте; правка поля её снимает", async () => {
    installMicrophone();
    const slot = open({ transcribeVoice: () => ({ kind: "failed", reason: "unavailable" }) });
    const field = await ownField(slot, "Каким путём?");
    fireEvent.change(field, { target: { value: "мой текст" } });
    const group = slot.getByRole("group", { name: "Каким путём?" });
    fireEvent.click(await record(slot, group));

    expect((await within(group).findByRole("alert")).textContent).toBe(failureText("unavailable"));
    const after = await ownField(slot, "Каким путём?");
    expect(after.value).toBe("мой текст");

    fireEvent.change(after, { target: { value: "мой текст!" } });
    expect(within(group).queryByRole("alert")).toBeNull();
  });

  it("отказ в доступе к микрофону показывается под полем", async () => {
    installMicrophone({ deny: "NotAllowedError" });
    const slot = open();
    const group = await slot.findByRole("group", { name: "Так?" });
    fireEvent.click(within(group).getByRole("button", { name: MIC }));
    expect((await within(group).findByRole("alert")).textContent).toBe(failureText("denied"));
    expect(within(group).getByRole("textbox", { name: "Свой ответ" })).toBeTruthy();
  });

  it("запись короче секунды не уходит на распознавание", async () => {
    installMicrophone();
    const slot = open();
    const group = await slot.findByRole("group", { name: "Каким путём?" });
    fireEvent.click(within(group).getByRole("button", { name: MIC }));
    fireEvent.click(await within(group).findByRole("button", { name: "Остановить и распознать" }));
    expect((await within(group).findByRole("alert")).textContent).toBe(failureText("too-short"));
    expect(slot.rpcCalls.some((c) => c.method === "transcribeVoice")).toBe(false);
  });

  it("пока идёт запись в одном поле, микрофоны остальных полей выключены", async () => {
    installMicrophone();
    const slot = open();
    const group = await slot.findByRole("group", { name: "Каким путём?" });
    fireEvent.click(within(group).getByRole("button", { name: MIC }));
    await within(group).findByRole("button", { name: "Остановить и распознать" });
    const others = slot.getAllByRole("button", { name: MIC }) as HTMLButtonElement[];
    expect(others).toHaveLength(5);
    expect(others.every((b) => b.disabled)).toBe(true);
  });
});

describe("когда микрофона нет или он не нужен", () => {
  it("в отвеченном брифе микрофонов нет", async () => {
    installMicrophone();
    const answered: AnswerRecord = {
      answer: { briefId: brief.id, answers: [{ questionId: "how", optionIds: [], own: "свой" }], criteria: { removed: [], edited: [], added: [] } },
      messageId: "msg_1",
      answeredAt: "2026-09-13T10:00:00.000Z",
    };
    const slot = open({ getBrief: () => ({ kind: "found", brief, answer: answered }) });
    await slot.findByText("Бриф отвечен");
    expect(slot.queryAllByRole("button", { name: MIC })).toHaveLength(0);
  });

  it("пока бриф отправляется, микрофоны выключены", async () => {
    installMicrophone();
    const slot = open({ answerBrief: () => new Promise(() => {}) });
    await slot.findByRole("textbox", { name: "Дополнить бриф" });
    fireEvent.click(within(slot.getByRole("group", { name: "Каким путём?" })).getByRole("button", { name: /RPC/ }));
    fireEvent.click(within(slot.getByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await waitFor(() => {
      const mics = slot.getAllByRole("button", { name: MIC }) as HTMLButtonElement[];
      expect(mics.length).toBeGreaterThan(0);
      expect(mics.every((b) => b.disabled)).toBe(true);
    });
  });

  it("браузер без записи звука — микрофон выключен, причина в подсказке", async () => {
    installNoMicrophone({ secure: true });
    const slot = open();
    await slot.findByRole("group", { name: "Каким путём?" });
    const mics = slot.getAllByRole("button", { name: MIC }) as HTMLButtonElement[];
    expect(mics.every((b) => b.disabled && b.title === unsupportedText("no-recorder"))).toBe(true);
  });

  it("страница не по HTTPS — микрофон выключен, в подсказке про HTTPS", async () => {
    installNoMicrophone({ secure: false });
    const slot = open();
    await slot.findByRole("group", { name: "Каким путём?" });
    const mics = slot.getAllByRole("button", { name: MIC }) as HTMLButtonElement[];
    expect(mics.every((b) => b.disabled && b.title === unsupportedText("insecure-origin"))).toBe(true);
  });
});
