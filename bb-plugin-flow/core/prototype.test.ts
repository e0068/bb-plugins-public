// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { PrototypeState } from "../shared/contract";
import {
  EMPTY_PROTOTYPE,
  frameMessage,
  markSent,
  mergeEdit,
  prototypeAddress,
  prototypeLines,
  unsent,
  withChoice,
  withComment,
  withForks,
  withoutComment,
} from "./prototype";

const forks = [
  { id: "side", label: "Кнопка отправки", options: [{ value: "right", label: "Справа" }, { value: "left", label: "Слева" }] },
  { id: "caption", label: "Подпись кнопки", options: [{ value: "send", label: "Отправить" }, { value: "done", label: "Готово" }] },
];
const shown = withForks(EMPTY_PROTOTYPE, forks);

describe("сообщения окна прототипа", () => {
  it("ready, choice и picked разбираются; чужое, битое и без метки протокола — null", () => {
    expect(frameMessage({ source: "bb-prototype", type: "ready", forks })).toEqual({ source: "bb-prototype", type: "ready", forks });
    expect(frameMessage({ source: "bb-prototype", type: "choice", fork: "side", value: "left" })?.type).toBe("choice");
    expect(frameMessage({ source: "bb-prototype", type: "picked", label: "кнопка «Отправить»" })?.type).toBe("picked");
    expect(frameMessage({ type: "choice", fork: "side", value: "left" })).toBeNull();
    expect(frameMessage({ source: "bb-prototype", type: "choice", fork: "" , value: "left" })).toBeNull();
    expect(frameMessage({ source: "bb-prototype", type: "ready", forks: Array.from({ length: 21 }, () => forks[0]) })).toBeNull();
    expect(frameMessage("ready")).toBeNull();
  });

  it("адрес прототипа — без якоря: тот же прототип с другим #… помнит тот же выбор", () => {
    expect(prototypeAddress("https://x.getbb.app/p.html?a=1#top")).toBe("https://x.getbb.app/p.html?a=1");
  });
});

describe("выбор и комментарии в прототипе", () => {
  it("выбор ложится только на известную развилку и её вариант", () => {
    const state = withChoice(withChoice(withChoice(shown, "side", "left"), "side", "middle"), "ghost", "x");
    expect(state.choices).toEqual({ side: "left" });
  });

  it("новый список развилок отбрасывает выбор, которого в нём больше нет", () => {
    const state = withForks(withChoice(withChoice(shown, "side", "left"), "caption", "done"), [forks[0]!]);
    expect(state.choices).toEqual({ side: "left" });
  });

  it("неотправленное — изменившийся с прошлой отправки выбор и комментарии без отметки; после отправки — пусто", () => {
    const state = withComment(withChoice(shown, "side", "left"), { id: "c1", text: "Сделай кнопку синей", at: "кнопка «Отправить»" });
    expect(unsent(state)).toEqual({ choices: [{ fork: "side", value: "left" }], comments: [{ id: "c1", text: "Сделай кнопку синей", at: "кнопка «Отправить»" }] });
    const sent = markSent(state);
    expect(unsent(sent)).toEqual({ choices: [], comments: [] });
    expect(markSent(sent)).toEqual(sent);
    expect(unsent(withChoice(sent, "side", "right")).choices).toEqual([{ fork: "side", value: "right" }]);
  });

  it("отправленный комментарий не удаляется, неотправленный — удаляется", () => {
    const sent = markSent(withComment(shown, { id: "c1", text: "раз" }));
    const both = withComment(sent, { id: "c2", text: "два" });
    expect(withoutComment(withoutComment(both, "c1"), "c2").comments.map((c) => c.id)).toEqual(["c1"]);
  });

  it("правка виджета не стирает отметки отправки: они — сервера", () => {
    const stored = markSent(withComment(withChoice(shown, "side", "left"), { id: "c1", text: "раз" }));
    const merged = mergeEdit(stored, { forks, choices: { side: "right" }, comments: [{ id: "c2", text: "два" }] });
    expect(merged.sentChoices).toEqual({ side: "left" });
    expect(merged.comments).toEqual([{ id: "c1", text: "раз", sent: true }, { id: "c2", text: "два" }]);
  });
});

describe("строки ответа агенту", () => {
  const state: PrototypeState = withComment(withChoice(shown, "side", "left"), { id: "c1", text: "Сделай кнопку синей", at: "кнопка «Отправить»" });

  it("выбор — «развилка — значение», комментарий — «место — текст», подписями, а не id", () => {
    expect(prototypeLines([state], "ru")).toEqual(["Выбор в прототипе:", "- Кнопка отправки — Слева", "Комментарии к прототипу:", "- кнопка «Отправить» — Сделай кнопку синей"]);
  });

  it("комментарий без места — один текст; по-английски — английские заголовки", () => {
    expect(prototypeLines([withComment(shown, { id: "c2", text: "Общее" })], "en")).toEqual(["Prototype comments:", "- Общее"]);
  });

  it("отправленное и пустое строк не дают", () => {
    expect(prototypeLines([markSent(state), shown], "ru")).toEqual([]);
  });
});
