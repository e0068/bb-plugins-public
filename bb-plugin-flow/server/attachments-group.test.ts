// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AnswerImage, DecisionAnswer } from "../shared/contract";
import { withGroupImages } from "./attachments";

const approval: DecisionAnswer = { briefId: "A", answers: [], outcome: { accepted: false, note: "вот так [Изображение 1]" } };
const png = (n: number, text: string): AnswerImage => ({ n, mimeType: "image/png", dataBase64: Buffer.from(text).toString("base64") });
type Member = { answer?: DecisionAnswer; note?: string; images?: AnswerImage[] };
const textOf = (image: AnswerImage | undefined) => Buffer.from(image?.dataBase64 ?? "", "base64").toString();

describe("картинки виджетов группы вместе с картинками Утверждения", () => {
  it("метка виджета, совпавшая с меткой Утверждения, переезжает на свободный номер вместе с картинкой", () => {
    const own = [png(1, "approval")];
    const demo = { note: "кнопка [Изображение 1]", images: [png(1, "demo")] };
    const { images, members } = withGroupImages(approval, own, [demo], "ru");
    expect(images.map((image) => [image.n, textOf(image)])).toEqual([[1, "approval"], [2, "demo"]]);
    expect(members[0]!.note).toBe("кнопка [Изображение 2]");
  });

  it("метки не совпали — номера остаются как были", () => {
    const demo = { note: "тема [Изображение 3]", images: [png(3, "demo")] };
    const { images, members } = withGroupImages(approval, [png(1, "approval")], [demo], "ru");
    expect(images.map((image) => image.n)).toEqual([1, 3]);
    expect(members[0]!.note).toBe("тема [Изображение 3]");
  });

  it("картинка без метки в словах виджета агенту не уходит", () => {
    const demo = { note: "без картинки", images: [png(1, "stale")] };
    expect(withGroupImages(approval, [], [demo], "ru").images).toEqual([]);
  });

  it("две Демонстрации с одной «картинкой 1» получают разные номера, а ответ брифа переписывается целиком", () => {
    const questions: Member = { answer: { briefId: "Q", answers: [{ questionId: "go", optionIds: [], own: "как на [Изображение 1]" }] } as DecisionAnswer, images: [png(1, "q")] };
    const demo: Member = { note: "и на [Изображение 1]", images: [png(1, "d")] };
    const { images, members } = withGroupImages({ ...approval, outcome: { accepted: false } }, [], [questions, demo], "ru");
    expect(images.map((image) => [image.n, textOf(image)])).toEqual([[1, "q"], [2, "d"]]);
    expect(members[0]!.answer?.answers[0]?.own).toBe("как на [Изображение 1]");
    expect(members[1]!.note).toBe("и на [Изображение 2]");
  });

  it("виджеты без картинок проходят как были", () => {
    const demo = { note: "просто слова" };
    expect(withGroupImages(approval, [], [demo], "ru")).toEqual({ images: [], members: [demo] });
  });
});
