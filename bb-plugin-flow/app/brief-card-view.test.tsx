// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { clearAttachments } from "./attachments";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => {
  window.localStorage.clear();
  clearAttachments("dec_view");
});
afterEach(cleanup);

const add = { target: 1, max: 2, risk: 0 };

const brief: DecisionBrief = {
  id: "dec_view",
  threadId: "thr_1",
  title: "Вид брифа",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: [{ text: "Загрузка в новом виде", before: "Рамка с шапкой", after: "Восемь ячеек" }, "Картинки в ответе"] },
  questions: [
    { id: "how", question: "Как сделать?", kind: "fork", allowOwn: false, options: [
      { id: "directive", action: "Директивой", recommended: true, description: "…", add, hides: ["where"] },
      { id: "script", action: "Скриптом", recommended: false, description: "…", add },
    ] },
    { id: "where", question: "Где хранить?", kind: "fork", allowOwn: false, options: [
      { id: "kv", action: "В kv", recommended: true, description: "…", add },
      { id: "disk", action: "На диске", recommended: false, description: "…", add },
    ] },
  ],
};

type Sent = Parameters<NonNullable<Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2]>["rpc"] extends infer R ? R extends { answerBrief: (input: infer I) => unknown } ? (input: I) => void : never : never>[0];

const open = (getBrief: () => unknown = () => ({ kind: "found", brief, answer: null })) => {
  const sent: Sent[] = [];
  const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: getBrief as never,
        answerBrief: (input) => {
          sent.push(input);
          return { kind: "accepted", record: { answer: input.answer, messageId: "msg_1", answeredAt: "2026-09-15T10:00:00.000Z" } satisfies AnswerRecord };
        },
      },
    },
  );
  return { slot, sent };
};

describe("загрузка брифа", () => {
  it("пока бриф не пришёл — скелетон из восьми ячеек со сдвигом фазы, без подписей", async () => {
    const { slot } = open(() => new Promise(() => {}));
    const skeleton = await slot.findByRole("group", { name: "Бриф загружается" });
    const cells = skeleton.querySelectorAll("[data-skeleton-cell]");
    expect(cells).toHaveLength(8);
    const delays = new Set([...cells].map((c) => (c as HTMLElement).style.animationDelay));
    expect(delays.size).toBe(8);
    expect(skeleton.textContent).toBe("");
  });
});

describe("пункт-изменение", () => {
  it("было и стало через стрелку, без заголовков «Было» и «Стало»; правится «стало»", async () => {
    const { slot } = open();
    const criteria = within(await slot.findByRole("group", { name: "Готово, когда" }));
    expect(criteria.queryByText("Было")).toBeNull();
    expect(criteria.queryByText("Стало")).toBeNull();
    expect(criteria.getByText("Рамка с шапкой")).toBeTruthy();
    expect(criteria.getByTestId("delta-arrow")).toBeTruthy();
    expect((criteria.getByRole("textbox", { name: "Пункт 1, стало" }) as HTMLTextAreaElement).value).toBe("Восемь ячеек");
  });
});

describe("скрытые вопросы", () => {
  it("выбор варианта с hides убирает вопрос, счётчик и ответ его не считают", async () => {
    const { slot, sent } = open();
    expect(await slot.findByRole("group", { name: "Где хранить?" })).toBeTruthy();
    fireEvent.click(within(slot.getByRole("group", { name: "Как сделать?" })).getByRole("button", { name: /Директивой/ }));
    await waitFor(() => expect(slot.queryByRole("group", { name: "Где хранить?" })).toBeNull());
    expect(slot.queryByText(/заполнено/)).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /Отправить бриф/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.answer.answers.map((a) => a.questionId)).toEqual(["how"]);
  });
});

describe("картинки в ответе", () => {
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shot.png", { type: "image/png" });
  const paste = (field: HTMLElement, file: File) =>
    act(() => {
      fireEvent.paste(field, { clipboardData: { items: [{ kind: "file", type: file.type, getAsFile: () => file }], files: [file], getData: () => "" } });
    });

  it("вставка картинки в поле ставит метку и превью; крестик убирает превью", async () => {
    const { slot } = open();
    const note = (await slot.findByRole("textbox", { name: "Дополнить бриф" })) as HTMLTextAreaElement;
    await paste(note, png());
    await waitFor(() => expect(slot.getByRole("img", { name: "картинка 1" })).toBeTruthy());
    expect(note.value).toContain("[картинка 1]");
    fireEvent.click(slot.getByRole("button", { name: "Убрать картинку 1" }));
    expect(slot.queryByRole("img", { name: "картинка 1" })).toBeNull();
  });

  it("метка встаёт сразу, а набранное до прихода картинки не затирается", async () => {
    const { slot } = open();
    const note = (await slot.findByRole("textbox", { name: "Дополнить бриф" })) as HTMLTextAreaElement;
    await paste(note, png());
    expect(note.value).toBe("[картинка 1]");
    fireEvent.change(note, { target: { value: "[картинка 1] вот тут кнопка" } });
    await waitFor(() => expect(slot.getByRole("img", { name: "картинка 1" })).toBeTruthy());
    expect(note.value).toBe("[картинка 1] вот тут кнопка");
  });

  it("svg не прикладывается, владелец видит почему", async () => {
    const { slot } = open();
    const note = (await slot.findByRole("textbox", { name: "Дополнить бриф" })) as HTMLTextAreaElement;
    await paste(note, new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }));
    expect(await slot.findByText(/PNG, JPEG, GIF или WebP/)).toBeTruthy();
    expect(slot.queryByRole("img", { name: "картинка 1" })).toBeNull();
    expect(note.value).toBe("");
  });

  it("картинка из выбора файлов уходит вместе с ответом", async () => {
    const { slot, sent } = open();
    await slot.findByRole("textbox", { name: "Дополнить бриф" });
    const picker = slot.container.querySelector<HTMLInputElement>("input[type=file]")!;
    let opened = 0;
    picker.addEventListener("click", () => (opened += 1));
    fireEvent.click(slot.getAllByRole("button", { name: "Приложить изображение" })[0]!);
    expect(opened).toBe(1);
    await act(async () => {
      fireEvent.change(picker, { target: { files: [png()] } });
    });
    await waitFor(() => expect(slot.getByRole("img", { name: "картинка 1" })).toBeTruthy());
    fireEvent.click(within(slot.getByRole("group", { name: "Как сделать?" })).getByRole("button", { name: /Директивой/ }));
    fireEvent.click(slot.getByRole("button", { name: /Отправить бриф/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.images?.map((i) => i.mimeType)).toEqual(["image/png"]);
  });
});
