// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, DecisionBrief, answerImagesRpcContract, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_demo_seen",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-10T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: { stage: "demo", final: false, done: ["Сделано"], pending: [], results: [] },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const clarify: DecisionBrief = {
  id: "dec_clarify_seen",
  threadId: "thr_1",
  title: "Уточнение",
  createdAt: "2026-10-10T10:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: true, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

const png = (text: string) => ({ mimeType: "image/png", dataBase64: btoa(text) });

const render = (brief: DecisionBrief, record: AnswerRecord, answerImages = vi.fn(() => ({ kind: "found" as const, images: [{ n: 2, ...png("second") }, { n: 4, ...png("fourth") }] }))) => {
  const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof answerImagesRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: record }), answerBrief: () => ({ kind: "not_found" }), answerImages, ...({ threadFiles } as object) } },
  );
  return { slot, answerImages };
};

const at = { messageId: "msg_1", answeredAt: "2026-10-10T10:05:00.000Z" };
const images = [{ n: 2, path: "attachments/decision-2.png" }, { n: 4, path: "attachments/decision-4.png" }];

describe("отвеченный бриф показывает ответ таким, каким его отправили", () => {
  it("комментарий к демонстрации: метки плашками, под текстом миниатюры картинок в порядке меток", async () => {
    const note = "Нет вариантов [Изображение 4] и слева [Изображение 2]";
    const { slot, answerImages } = render(demo, { ...at, images, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note } } });
    const thumbs = await slot.findAllByRole("img", { name: /^Изображение \d$/ });
    expect(thumbs.map((img) => img.getAttribute("alt"))).toEqual(["Изображение 4", "Изображение 2"]);
    expect(thumbs[0]!.getAttribute("src")).toBe(`data:image/png;base64,${btoa("fourth")}`);
    expect([...slot.container.querySelectorAll("[data-image-tag]")].map((tag) => tag.textContent)).toEqual(["Изображение 4", "Изображение 2"]);
    expect(answerImages).toHaveBeenCalledTimes(1);
  });

  it("тап по миниатюре разворачивает картинку на весь экран", async () => {
    const { slot } = render(demo, { ...at, images, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "смотри [Изображение 2]" } } });
    fireEvent.click(await slot.findByRole("button", { name: "Открыть изображение 2" }));
    const viewer = await screen.findByRole("dialog", { name: "Изображение 2" });
    expect(within(viewer).getByRole("img", { name: "Изображение 2" }).getAttribute("src")).toBe(`data:image/png;base64,${btoa("second")}`);
  });

  it("свой ответ в уточнении несёт свои картинки", async () => {
    const { slot } = render(clarify, { ...at, images, answer: { briefId: clarify.id, answers: [{ questionId: "ok", optionIds: [], own: "вот так [Изображение 2]" }] } });
    expect(await slot.findByRole("img", { name: "Изображение 2" })).toBeTruthy();
    expect(slot.getByText("вот так", { exact: false })).toBeTruthy();
  });

  it("картинка, которую bb не отдал, остаётся плашкой без миниатюры", async () => {
    const answerImages = vi.fn(() => ({ kind: "found" as const, images: [{ n: 2, ...png("second") }] }));
    const { slot } = render(demo, { ...at, images, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "[Изображение 2] [Изображение 4]" } } }, answerImages);
    await slot.findByRole("img", { name: "Изображение 2" });
    expect(slot.queryByRole("img", { name: "Изображение 4" })).toBeNull();
    expect(slot.queryByRole("status", { name: "Изображение 4 читается" })).toBeNull();
    expect(slot.container.querySelectorAll("[data-image-tag]")).toHaveLength(2);
  });

  it("ответ, записанный без картинок, сервер о них не спрашивает и метки рисует плашками", async () => {
    const { slot, answerImages } = render(demo, { ...at, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "старый ответ [Изображение 1]" } } });
    await slot.findByText("Ответ отправлен");
    expect(slot.container.querySelectorAll("[data-image-tag]")).toHaveLength(1);
    expect(slot.queryByRole("img", { name: "Изображение 1" })).toBeNull();
    expect(answerImages).not.toHaveBeenCalled();
  });
});

describe("ответ с прежней меткой «картинка»", () => {
  it("ответ, отправленный до переименования, по-прежнему показывает плашки и миниатюры", async () => {
    const { slot } = render(demo, { ...at, images, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "раньше [картинка 2] и [картинка 4]" } } });
    expect(await slot.findAllByRole("img", { name: /^Изображение \d$/ })).toHaveLength(2);
    expect([...slot.container.querySelectorAll("[data-image-tag]")].map((tag) => tag.textContent)).toEqual(["картинка 2", "картинка 4"]);
  });
});

describe("отвеченный бриф с файлом", () => {
  it("архив виден плиткой с именем, а не картинкой", async () => {
    const answerImages = vi.fn(() => ({ kind: "found" as const, images: [{ n: 1, mimeType: "application/zip", dataBase64: btoa("PK"), name: "Frame 456346.svg.zip" }] }));
    const { slot } = render(demo, { ...at, images: [{ n: 1, path: "attachments/decision-1-Frame.zip", name: "Frame 456346.svg.zip" }], answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "и архив [файл 1]" } } }, answerImages);
    await vi.waitFor(() => expect(slot.container.querySelector("[data-file-tile]")?.textContent).toBe("Frame 456346.svg.zip"));
    expect([...slot.container.querySelectorAll("[data-image-tag]")].map((tag) => tag.textContent)).toEqual(["файл 1"]);
    expect(slot.queryByRole("img", { name: "Изображение 1" })).toBeNull();
  });
});

describe("ответ, вставший в ленту сообщением", () => {
  it("карточка не повторяет слов владельца и его картинок, остаётся итог", async () => {
    const { slot, answerImages } = render(clarify, { ...at, images, posted: true, answer: { briefId: clarify.id, answers: [{ questionId: "ok", optionIds: [], own: "вот так [Изображение 2]" }] } });
    await slot.findByText("Уточнение отвечено");
    expect(slot.queryByText("вот так", { exact: false })).toBeNull();
    expect(slot.container.querySelectorAll("[data-image-tag]")).toHaveLength(0);
    expect(answerImages).not.toHaveBeenCalled();
  });

  it("у демонстрации остаются сделанное и результаты", async () => {
    const { slot } = render(demo, { ...at, posted: true, answer: { briefId: demo.id, answers: [], outcome: { accepted: false, note: "поправь" } } });
    expect((await slot.findAllByText("Сделано")).length).toBeGreaterThan(0);
    expect(slot.queryByText("поправь", { exact: false })).toBeNull();
  });
});
