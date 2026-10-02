// @vitest-environment node
// Агент выделяет слова жирным `**…**`: бриф показывает их жирными, а не звёздочками.
import { describe, expect, it } from "vitest";

import { hasMarkup, plainText, textParts } from "./inline-links";

describe("жирный в тексте брифа", () => {
  it("**слово** внутри фразы — текст, жирная часть, текст", () => {
    expect(textParts("Строка: **Название** → номер")).toEqual([
      { kind: "text", text: "Строка: " },
      { kind: "text", text: "Название", strong: true },
      { kind: "text", text: " → номер" },
    ]);
  });

  it("ссылка внутри жирного остаётся ссылкой и жирной", () => {
    expect(textParts("**[server.ts](bb-plugin-flow/server.ts)**")).toEqual([
      { kind: "link", label: "server.ts", target: "bb-plugin-flow/server.ts", line: null, strong: true },
    ]);
  });

  it("одиночные и непарные звёздочки остаются текстом", () => {
    expect(textParts("a * b ** c")).toEqual([{ kind: "text", text: "a * b ** c" }]);
    expect(textParts("**")).toEqual([{ kind: "text", text: "**" }]);
  });

  it("диктор читает жирное без звёздочек", () => {
    expect(plainText("Строка: **Название** и **Навык**")).toBe("Строка: Название и Навык");
  });

  it("`**` в пути ссылки не открывает жирное: две такие ссылки остаются ссылками", () => {
    expect(textParts("[a](docs/**/x.md) и [b](docs/**/y.md)")).toEqual([
      { kind: "link", label: "a", target: "docs/**/x.md", line: null },
      { kind: "text", text: " и " },
      { kind: "link", label: "b", target: "docs/**/y.md", line: null },
    ]);
  });

  it("жирное вокруг ссылки с `**` в пути — ссылка цела и жирная", () => {
    expect(textParts("**см. [a](docs/**/a.md)**")).toEqual([
      { kind: "text", text: "см. ", strong: true },
      { kind: "link", label: "a", target: "docs/**/a.md", line: null, strong: true },
    ]);
  });

  it("разметка — это и ссылка, и жирное", () => {
    expect(hasMarkup("**Название** → номер")).toBe(true);
    expect(hasMarkup("[a](x.md)")).toBe(true);
    expect(hasMarkup("просто текст и glob docs/**")).toBe(false);
  });
});
