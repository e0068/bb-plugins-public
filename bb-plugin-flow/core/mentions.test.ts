import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyMention, mentionAt, rankByName } from "./mentions";

describe("слово с `/` или `@` у курсора", () => {
  it("`/` в начале поля открывает поиск по набранному после него", () => {
    expect(mentionAt("/spe", 4)).toEqual({ trigger: "/", query: "spe", start: 0 });
  });

  it("`@` после пробела открывает поиск по набранному, путь с косой чертой — часть запроса", () => {
    expect(mentionAt("смотри @app/brief", 17)).toEqual({ trigger: "@", query: "app/brief", start: 7 });
  });

  it("одинокий знак — поиск с пустым запросом", () => {
    expect(mentionAt("текст\n/", 7)).toEqual({ trigger: "/", query: "", start: 6 });
  });

  it("знак внутри слова — ссылка, путь или почта — поиска не открывает", () => {
    expect(mentionAt("docs/tasks", 10)).toBeNull();
    expect(mentionAt("https://getbb.app", 17)).toBeNull();
    expect(mentionAt("me@mail.ru", 10)).toBeNull();
  });

  it("после `/` запрос без второй косой черты: `/a/b` — путь, а не навык", () => {
    expect(mentionAt("/docs/tasks", 11)).toBeNull();
  });

  it("пробел между знаком и курсором закрывает поиск", () => {
    expect(mentionAt("/plan потом", 11)).toBeNull();
  });

  it("курсор вне текста — поиска нет", () => {
    expect(mentionAt("/plan", 0)).toBeNull();
    expect(mentionAt("/plan", 9)).toBeNull();
  });

  it("слово берётся до курсора, а не до конца текста", () => {
    expect(mentionAt("/plan дальше", 3)).toEqual({ trigger: "/", query: "pl", start: 0 });
  });
});

describe("вставка выбранного", () => {
  it("набранное заменяется на знак и значение; пробел за ним уже есть — второй не ставится, курсор встаёт за пробелом", () => {
    const token = mentionAt("сделай /sp и всё", 10)!;
    expect(applyMention("сделай /sp и всё", token, "spec")).toEqual({ text: "сделай /spec и всё", caret: 13 });
  });

  it("путь вставляется со своим знаком", () => {
    const token = mentionAt("@brief", 6)!;
    expect(applyMention("@brief", token, "app/brief-card.tsx")).toEqual({ text: "@app/brief-card.tsx ", caret: 20 });
  });

  it("текст вне набранного не меняется", () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !/\s$/.test(s) && s !== ""), fc.stringMatching(/^[a-z-]{0,8}$/), fc.string().filter((s) => !/^\s/.test(s)), fc.stringMatching(/^[a-z:-]{1,12}$/), (before, query, after, value) => {
        const head = `${before} /${query}`;
        const token = mentionAt(head, head.length)!;
        const { text, caret } = applyMention(head + after, token, value);
        expect(text).toBe(`${before} /${value} ${after}`);
        expect(caret).toBe(before.length + value.length + 3);
      }),
    );
  });
});

describe("поиск по имени", () => {
  const items = ["code-review", "spec", "plan", "flow-demo", "prototype", "bb-global-skills:spec-writer"].map((name) => ({ name }));

  it("пустой запрос отдаёт всё в исходном порядке", () => {
    expect(rankByName(items, "", 10)).toEqual(items);
  });

  it("имена, начинающиеся с запроса, — первыми, дальше остальные совпадения, без учёта регистра", () => {
    expect(rankByName(items, "SPEC", 10).map((i) => i.name)).toEqual(["spec", "bb-global-skills:spec-writer"]);
    expect(rankByName(items, "o", 10).map((i) => i.name)).toEqual(["code-review", "flow-demo", "prototype", "bb-global-skills:spec-writer"]);
  });

  it("не больше предела", () => {
    expect(rankByName(items, "", 2)).toEqual(items.slice(0, 2));
  });

  it("каждое найденное содержит запрос, и ничего с запросом не потеряно до предела", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ name: fc.string() })), fc.string({ maxLength: 3 }), (list, query) => {
        const found = rankByName(list, query, 1000);
        const q = query.toLowerCase();
        expect(found.every((i) => i.name.toLowerCase().includes(q))).toBe(true);
        expect(found.length).toBe(list.filter((i) => i.name.toLowerCase().includes(q)).length);
      }),
    );
  });
});
