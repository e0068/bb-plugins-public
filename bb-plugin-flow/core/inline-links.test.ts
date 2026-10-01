// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { plainText, textParts } from "./inline-links";

describe("ссылки в тексте брифа", () => {
  it("текст без ссылок — одна часть как есть", () => {
    expect(textParts("Просто текст (со скобками) и [квадратными]")).toEqual([{ kind: "text", text: "Просто текст (со скобками) и [квадратными]" }]);
  });

  it("ссылка внутри фразы — текст, ссылка, текст", () => {
    expect(textParts("Правка в [choose_flow (выбор flow) — server.ts](bb-plugin-flow/server.ts) готова")).toEqual([
      { kind: "text", text: "Правка в " },
      { kind: "link", label: "choose_flow (выбор flow) — server.ts", target: "bb-plugin-flow/server.ts", line: null },
      { kind: "text", text: " готова" },
    ]);
  });

  it("строка файла — `:12` и `#L12` — уходит из пути в номер строки", () => {
    expect(textParts("[a](app/x.tsx:12)")).toEqual([{ kind: "link", label: "a", target: "app/x.tsx", line: 12 }]);
    expect(textParts("[a](/abs/x.md#L7)")).toEqual([{ kind: "link", label: "a", target: "/abs/x.md", line: 7 }]);
  });

  it("адрес остаётся целым, порт не строка", () => {
    expect(textParts("[PR](http://localhost:8080)")).toEqual([{ kind: "link", label: "PR", target: "http://localhost:8080", line: null }]);
  });

  it("цель с пробелами — в угловых скобках, со скобками внутри — парами", () => {
    expect(textParts("[a](<docs/my file.md>)")).toEqual([{ kind: "link", label: "a", target: "docs/my file.md", line: null }]);
    expect(textParts("[a](docs/f(x).md)")).toEqual([{ kind: "link", label: "a", target: "docs/f(x).md", line: null }]);
  });

  it("две ссылки подряд и пустая цель — пустая цель остаётся текстом", () => {
    expect(textParts("[a](x.md), [b](y.md); [c]()")).toEqual([
      { kind: "link", label: "a", target: "x.md", line: null },
      { kind: "text", text: ", " },
      { kind: "link", label: "b", target: "y.md", line: null },
      { kind: "text", text: "; [c]()" },
    ]);
  });

  it("части собираются обратно в текст без потерь, если ссылок нет", () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !s.includes("](")), (s) => {
        expect(textParts(s).map((p) => (p.kind === "text" ? p.text : "")).join("")).toBe(s);
      }),
    );
  });

  it("колонка и диапазон строк не остаются в пути — файл открывается на первой строке", () => {
    expect(textParts("[a](x.ts:12:5)")).toEqual([{ kind: "link", label: "a", target: "x.ts", line: 12 }]);
    expect(textParts("[a](x.md#L12-L20)")).toEqual([{ kind: "link", label: "a", target: "x.md", line: 12 }]);
  });

  it("незакрытая скобка в тексте не съедает его — ссылкой становится только ближняя пара", () => {
    expect(textParts("шаг [1 из 3, см. [файл](x.md)")).toEqual([
      { kind: "text", text: "шаг [1 из 3, см. " },
      { kind: "link", label: "файл", target: "x.md", line: null },
    ]);
  });

  it("plainText — ссылка читается своим текстом", () => {
    expect(plainText("См. [server.ts](bb-plugin-flow/server.ts:3).")).toBe("См. server.ts.");
  });
});
