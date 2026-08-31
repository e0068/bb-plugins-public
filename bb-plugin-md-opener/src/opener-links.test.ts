import { describe, expect, it } from "vitest";

import { extractLinkHrefs } from "./opener-links";

describe("extractLinkHrefs", () => {
  it("берёт локальные markdown-ссылки, отсекает внешние схемы и якоря", () => {
    const body = [
      "см. [задачу](tasks/x.md) и [индекс](../INDEX.md)",
      "[сайт](https://example.com) — внешняя",
      "[якорь](#section) — не файл",
      "[почта](mailto:a@b.c)",
    ].join("\n");
    expect(extractLinkHrefs(body)).toEqual(["tasks/x.md", "../INDEX.md"]);
  });

  it("НЕ поднимает Claude-@import: kasimov его как ссылку не рендерит", () => {
    // Отличие kasimov-варианта от исходного: движок делает кликабельной только
    // markdown-форму `[текст](href)`, поэтому @import сюда не попадает — иначе
    // сервер посчитал бы живой ссылку, которую фронт никогда не откроет.
    const body = "конфиг тянет @AGENTS.md и @~/.claude/skills/x.md";
    expect(extractLinkHrefs(body)).toEqual([]);
  });

  it("не матчит почту user@host в прозе", () => {
    const body = "пиши на user@example.com — это не ссылка";
    expect(extractLinkHrefs(body)).toEqual([]);
  });

  it("сохраняет порядок и сворачивает дубли одного написания", () => {
    const body = "[a](a.md) [b](b.md) снова [a](a.md)";
    expect(extractLinkHrefs(body)).toEqual(["a.md", "b.md"]);
  });

  it("абсолютный путь-ссылка проходит как внутривкладочный", () => {
    const body = "[абс](/Users/me/notes/n.md)";
    expect(extractLinkHrefs(body)).toEqual(["/Users/me/notes/n.md"]);
  });
});
