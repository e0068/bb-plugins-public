// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionAnswer, DecisionBrief, decisionsRpcContract } from "../shared/contract";
import { readStoredDraft } from "./draft-storage";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_criteria",
  threadId: "thr_1",
  title: "Критерий пунктами",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "docs/p.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: false },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    criteria: ["Пункты с крестом", "Черновик сохраняется", "Порядок артефактов"],
  },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
};

const record = (answer: DecisionAnswer): AnswerRecord => ({ answer, messageId: "msg_1", answeredAt: "2026-09-13T10:00:00.000Z" });

const open = (answer: AnswerRecord | null = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer }),
        answerBrief: ({ answer: sent }) => ({ kind: "accepted", record: record(sent) }),
      },
    },
  );

const criteria = async (slot: ReturnType<typeof open>) => within(await slot.findByRole("group", { name: "Готово, когда" }));

describe("раскладка брифа", () => {
  it("сначала вопросы, потом «Готово, когда», потом артефакты; шапки «Бриф» нет", async () => {
    const slot = open();
    const question = await slot.findByRole("group", { name: "Так?" });
    const done = slot.getByRole("group", { name: "Готово, когда" });
    const artifacts = slot.getByRole("group", { name: "Артефакты" });
    expect(question.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(done.compareDocumentPosition(artifacts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.queryByText("Бриф")).toBeNull();
  });
});

describe("пункты «Готово, когда»", () => {
  it("крест снимает пункт, «Вернуть» возвращает, счётчик оставленных следует", async () => {
    const slot = open();
    const list = await criteria(slot);
    expect(list.getByText("оставлено 3 из 3")).toBeTruthy();
    fireEvent.click(list.getByRole("button", { name: "Пункт 2 не нужен" }));
    expect(list.getByText("оставлено 2 из 3")).toBeTruthy();
    expect(list.queryByRole("textbox", { name: "Пункт 2" })).toBeNull();
    fireEvent.click(list.getByRole("button", { name: "Вернуть пункт 2" }));
    expect(list.getByRole("textbox", { name: "Пункт 2" })).toBeTruthy();
  });

  it("снятое, переписанное и добавленное уходит в ответе; пункты не держат отправку", async () => {
    const slot = open();
    const list = await criteria(slot);
    fireEvent.click(list.getByRole("button", { name: "Пункт 3 не нужен" }));
    fireEvent.change(list.getByRole("textbox", { name: "Пункт 1" }), { target: { value: "Пункты с крестом справа" } });
    fireEvent.change(list.getByRole("textbox", { name: "Дополнить" }), { target: { value: "Тесты зелёные" } });
    fireEvent.click(within(slot.getByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await slot.findByText("Бриф отвечен");
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: DecisionAnswer };
    expect(call.answer.criteria).toEqual({ removed: [2], edited: [{ index: 0, text: "Пункты с крестом справа" }], added: ["Тесты зелёные"] });
  });

  it("отвеченный бриф показывает снятый пункт и правки без полей и кнопок", async () => {
    const slot = open(record({ briefId: brief.id, answers: [{ questionId: "read", optionIds: ["yes"] }], criteria: { removed: [1], edited: [{ index: 0, text: "Иначе" }], added: ["Ещё"] } }));
    const list = await criteria(slot);
    expect(list.getByText("Черновик сохраняется")).toBeTruthy();
    expect(list.getByText("Иначе")).toBeTruthy();
    expect(list.getByText("Ещё")).toBeTruthy();
    expect(list.queryAllByRole("textbox")).toHaveLength(0);
    expect(list.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("правка пунктов в поле", () => {
  it("первый символ в «Дополнить» делает его пунктом, не сбивая фокус", async () => {
    const list = await criteria(open());
    const field = list.getByRole("textbox", { name: "Дополнить" });
    field.focus();
    fireEvent.change(field, { target: { value: "а" } });
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-label")).toBe("Добавленный пункт 1");
  });

  it("стёртый до пустоты пункт при уходе из поля возвращает исходный текст", async () => {
    const list = await criteria(open());
    const field = list.getByRole("textbox", { name: "Пункт 2" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect((list.getByRole("textbox", { name: "Пункт 2" }) as HTMLTextAreaElement).value).toBe("Черновик сохраняется");
  });
});

describe("черновик переживает уход из треда", () => {
  it("выбор и снятый пункт на месте после повторного открытия, после отправки черновик пропадает", async () => {
    const first = open();
    fireEvent.click(within(await first.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    fireEvent.click((await criteria(first)).getByRole("button", { name: "Пункт 2 не нужен" }));
    cleanup();

    const again = open();
    const yes = within(await again.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ });
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    expect((await criteria(again)).getByRole("button", { name: "Вернуть пункт 2" })).toBeTruthy();
    fireEvent.click(again.getByRole("button", { name: "Отправить бриф" }));
    await again.findByText("Бриф отвечен");
    cleanup();

    const fresh = open();
    expect((await criteria(fresh)).getByText("оставлено 3 из 3")).toBeTruthy();
  });

  it("ответ из другой вкладки стирает черновик этого брифа", async () => {
    let stored: AnswerRecord | null = null;
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief, answer: stored }), answerBrief: () => ({ kind: "not_found" }) } },
    );
    fireEvent.click((await criteria(slot)).getByRole("button", { name: "Пункт 1 не нужен" }));
    expect(readStoredDraft(brief.id)).not.toBeNull();
    stored = record({ briefId: brief.id, answers: [{ questionId: "read", optionIds: ["yes"] }] });
    await slot.emitRealtime("decisions:answered", { id: brief.id });
    await slot.findByText("Бриф отвечен");
    expect(readStoredDraft(brief.id)).toBeNull();
  });
});
