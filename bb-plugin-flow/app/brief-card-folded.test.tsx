// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, DecisionBrief, Fold, decisionsRpcContract } from "../shared/contract";
import { emptyDraft } from "./draft";
import { encodeDraft } from "./draft-storage";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const T = "2026-10-12T10:00:00.000Z";
const FOLDED = "Виджеты отправлены обратно агенту, ваши выборы сохранены";

const option = (id: string, action: string, recommended = false) => ({ id, action, recommended, description: `Описание ${action}.` });
const questions = (id: string, title: string, ask: string): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title,
  createdAt: T,
  kind: "brief",
  questions: [{ id: "route", question: ask, kind: "fork", allowOwn: false, options: [option("left", "Налево", true), option("right", "Направо")] }],
});
const first = questions("dec_q1", "Первый", "Куда идём?");
const second = questions("dec_q2", "Второй", "Что дальше?");
const approval: DecisionBrief = {
  id: "dec_ok",
  threadId: "thr_1",
  title: "Утверждение плана",
  createdAt: T,
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, next: "Дальше", done: ["Сделано в плане"], pending: [], results: [{ label: "plan.md", target: "docs/plan.md" }] },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};

const record = (answer: AnswerRecord["answer"], patch: Partial<AnswerRecord> = {}): AnswerRecord => ({ answer, messageId: "msg_1", answeredAt: "2026-10-12T10:05:00.000Z", ...patch });
const leftAnswer = (id: string) => record({ briefId: id, answers: [{ questionId: "route", optionIds: ["left"] }] });
const commented = record({ briefId: approval.id, answers: [], outcome: { accepted: false, note: "переделай план" } });

type Found = { kind: "found"; brief: DecisionBrief; answer: AnswerRecord | null; fold?: Fold; draft?: string };
type Rpc = NonNullable<Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2]>["rpc"];

/** Директива виджета `id`; getBrief отдаёт записи по id, как сервер. */
const render = (id: string, records: Record<string, Found>) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id }, source: `::decision{id="${id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    { rpc: { ...({ threadFiles } as object), answerBrief: () => ({ kind: "not_found" }), getBrief: ({ id: asked }: { id: string }) => records[asked] ?? { kind: "not_found" } } as unknown as Rpc },
  );

const GROUP: Fold = { holder: approval.id, ids: [first.id, approval.id] };

describe("отвеченный виджет остаётся в ленте целиком", () => {
  it("ответ встал в ленту сообщением, а вопросы, выбранное и статус всё равно видны", async () => {
    const slot = render(first.id, { [first.id]: { kind: "found", brief: first, answer: leftAnswer(first.id) } });
    expect((await slot.findAllByText(/Куда идём\?/)).length).toBeGreaterThan(0);
    expect(slot.getAllByText(/Налево/).length).toBeGreaterThan(0);
    expect(slot.getByText("Ответ отправлен")).toBeTruthy();
    expect(slot.container.querySelector("[data-brief-folded]")).toBeNull();
  });

  it("утверждение, принятое «Продолжить», рисуется итогом и статусом, а не одной строкой", async () => {
    const slot = render(approval.id, { [approval.id]: { kind: "found", brief: approval, answer: record({ briefId: approval.id, answers: [], outcome: { accepted: true } }) } });
    expect((await slot.findAllByText("Утверждено")).length).toBeGreaterThan(0);
    expect(slot.getByText("Ответ отправлен")).toBeTruthy();
    expect(slot.container.querySelector("[data-brief-folded]")).toBeNull();
  });
});

describe("комментарий к утверждению свернул группу", () => {
  const records = (): Record<string, Found> => ({
    [first.id]: { kind: "found", brief: first, answer: leftAnswer(first.id), fold: GROUP },
    [approval.id]: { kind: "found", brief: approval, answer: commented, fold: GROUP },
  });

  it("на месте утверждения — одна строка; виджетов группы, вопросов и итога под ней нет", async () => {
    const slot = render(approval.id, records());
    expect(await slot.findByText(FOLDED)).toBeTruthy();
    expect(slot.queryByText(/Куда идём\?/)).toBeNull();
    expect(slot.queryByText("Комментарий")).toBeNull();
  });

  it("остальные виджеты группы в ленте не рисуются вовсе", async () => {
    const slot = render(first.id, records());
    await waitFor(() => expect(slot.container.querySelector("[data-decision-frame]")).not.toBeNull());
    expect(slot.queryByText(FOLDED)).toBeNull();
    expect(slot.queryByText(/Куда идём\?/)).toBeNull();
    expect(slot.queryByText("Ответ отправлен")).toBeNull();
  });

  it("раскрывается по нажатию: виджеты группы по порядку, только для чтения, без строки статуса; повторное нажатие сворачивает", async () => {
    const slot = render(approval.id, records());
    const line = await slot.findByRole("button", { name: FOLDED });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect((await slot.findAllByText(/Куда идём\?/)).length).toBeGreaterThan(0);
    expect(slot.getAllByText(/Налево/).length).toBeGreaterThan(0);
    expect((await slot.findAllByText("Комментарий")).length).toBeGreaterThan(0);
    expect(slot.getAllByText(/переделай план/).length).toBeGreaterThan(0);
    expect(slot.queryByText("Ответ отправлен")).toBeNull();
    expect(slot.queryByRole("button", { name: /Отправить|Продолжить/ })).toBeNull();
    fireEvent.click(line);
    expect(slot.queryByText(/Куда идём\?/)).toBeNull();
  });

  it("неотвеченный виджет группы раскрывается с черновиком владельца, а не с рекомендацией агента", async () => {
    const draft = encodeDraft({ ...emptyDraft(), entries: { route: { optionIds: ["right"], own: "", picked: ["right"] } } });
    const group: Fold = { holder: approval.id, ids: [second.id, approval.id] };
    const slot = render(approval.id, {
      [second.id]: { kind: "found", brief: second, answer: null, fold: group, draft },
      [approval.id]: { kind: "found", brief: approval, answer: commented, fold: group },
    });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    expect((await slot.findAllByText(/Что дальше\?/)).length).toBeGreaterThan(0);
    expect(slot.getAllByText(/Направо/).length).toBeGreaterThan(0);
    expect(slot.queryByText("Ответ отправлен")).toBeNull();
  });

  it("неотвеченный виджет без черновика раскрывается тем, что владелец видел: рекомендацией агента", async () => {
    const group: Fold = { holder: approval.id, ids: [second.id, approval.id] };
    const slot = render(approval.id, {
      [second.id]: { kind: "found", brief: second, answer: null, fold: group },
      [approval.id]: { kind: "found", brief: approval, answer: commented, fold: group },
    });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    expect(((await slot.findAllByText(/Налево/)).length)).toBeGreaterThan(0);
  });

  it("виджет группы, которого сервер уже не знает, раскрытую строку не роняет", async () => {
    const slot = render(approval.id, { [approval.id]: { kind: "found", brief: approval, answer: commented, fold: GROUP } });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    expect((await slot.findAllByText(/переделай план/)).length).toBeGreaterThan(0);
    expect(slot.queryByText(/Куда идём\?/)).toBeNull();
  });
});

describe("сообщение в чат при ждущем виджете", () => {
  it("сворачивает его в ту же строку, которая раскрывается и показывает виджет с черновиком", async () => {
    const draft = encodeDraft({ ...emptyDraft(), entries: { route: { optionIds: ["right"], own: "", picked: ["right"] } } });
    const slot = render(first.id, { [first.id]: { kind: "found", brief: first, answer: null, fold: { holder: first.id, ids: [first.id] }, draft } });
    const line = await slot.findByRole("button", { name: FOLDED });
    expect(slot.queryByText(/Куда идём\?/)).toBeNull();
    fireEvent.click(line);
    expect((await slot.findAllByText(/Куда идём\?/)).length).toBeGreaterThan(0);
    expect(slot.getAllByText(/Направо/).length).toBeGreaterThan(0);
  });

  it("старой строки «Виджет вернулся агенту…» без раскрытия больше нет", async () => {
    const slot = render(first.id, { [first.id]: { kind: "found", brief: first, answer: null, fold: { holder: first.id, ids: [first.id] } } });
    await slot.findByText(FOLDED);
    expect(slot.queryByText(/Виджет вернулся агенту/)).toBeNull();
    expect(slot.container.querySelector("[data-brief-returned]")).toBeNull();
  });
});

describe("виджеты прежнего вида в свёрнутой группе", () => {
  const legacy: DecisionBrief = { ...first, id: "dec_old", title: "Старый", questions: [{ id: "priority", question: "Приоритет работы?", kind: "choice", allowOwn: false, options: [{ id: "speed", action: "Скорость", recommended: false }, { id: "quality", action: "Качество", recommended: true }] }] };
  const group: Fold = { holder: approval.id, ids: [legacy.id, approval.id] };

  it("отвеченный рисуется своим прежним видом, неотвеченный — не рисуется: у него нет вида для чтения", async () => {
    const answered = record({ briefId: legacy.id, answers: [{ questionId: "priority", optionIds: ["speed"] }] });
    const slot = render(approval.id, { [legacy.id]: { kind: "found", brief: legacy, answer: answered, fold: group }, [approval.id]: { kind: "found", brief: approval, answer: commented, fold: group } });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    expect((await slot.findAllByText(/Приоритет работы\?/)).length).toBeGreaterThan(0);
    cleanup();
    const open = render(approval.id, { [legacy.id]: { kind: "found", brief: legacy, answer: null, fold: group }, [approval.id]: { kind: "found", brief: approval, answer: commented, fold: group } });
    fireEvent.click(await open.findByRole("button", { name: FOLDED }));
    expect((await open.findAllByText(/переделай план/)).length).toBeGreaterThan(0);
    expect(open.queryByText(/Приоритет работы\?/)).toBeNull();
  });
});

describe("неотвеченное утверждение в раскрытой группе", () => {
  const group: Fold = { holder: approval.id, ids: [first.id, approval.id] };
  const open = async (draft?: string) => {
    const slot = render(approval.id, {
      [first.id]: { kind: "found", brief: first, answer: leftAnswer(first.id), fold: group },
      [approval.id]: { kind: "found", brief: approval, answer: null, fold: group, ...(draft === undefined ? {} : { draft }) },
    });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    await slot.findAllByText(/Куда идём\?/);
    return slot;
  };

  it("не названо утверждённым: черновик вердикта не показывает, только текст комментария, если он есть", async () => {
    const withNote = await open(encodeDraft({ ...emptyDraft(), outcomeNote: "хочу по-другому" }));
    expect(withNote.getAllByText(/хочу по-другому/).length).toBeGreaterThan(0);
    expect(withNote.queryByText("Утверждено")).toBeNull();
    cleanup();
    const bare = await open();
    expect(bare.queryByText("Утверждено")).toBeNull();
  });

  it("отвеченное «Продолжить» в той же группе по-прежнему утверждено", async () => {
    const slot = render(approval.id, {
      [first.id]: { kind: "found", brief: first, answer: leftAnswer(first.id), fold: group },
      [approval.id]: { kind: "found", brief: approval, answer: record({ briefId: approval.id, answers: [], outcome: { accepted: true } }), fold: group },
    });
    fireEvent.click(await slot.findByRole("button", { name: FOLDED }));
    expect((await slot.findAllByText("Утверждено")).length).toBeGreaterThan(0);
  });
});
