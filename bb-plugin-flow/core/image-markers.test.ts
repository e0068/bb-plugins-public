// @vitest-environment node
import { describe, expect, it } from "vitest";

import { markerNumbers, splitMarkers, withoutMarker } from "./image-markers";

const ru = (n: number) => `[картинка ${n}]`;
const en = (n: number) => `[image ${n}]`;

describe("метки картинок в тексте комментария", () => {
  it("текст режется на куски и метки, склейка кусков даёт исходный текст", () => {
    const text = "[картинка 1] Заодно поменяй шрифт.\n[картинка 2] и [картинка 3]";
    const parts = splitMarkers(text, ru);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.marker).map((p) => p.text)).toEqual(["[картинка 1]", "[картинка 2]", "[картинка 3]"]);
  });

  it("метка другого языка и похожий текст — не метка", () => {
    expect(splitMarkers("[image 1] и [картинка] и [картинка x]", ru).some((p) => p.marker)).toBe(false);
    expect(splitMarkers("see [image 12]", en)).toEqual([{ text: "see ", marker: false }, { text: "[image 12]", marker: true }]);
  });

  it("текст без меток — один кусок", () => {
    expect(splitMarkers("просто текст", ru)).toEqual([{ text: "просто текст", marker: false }]);
    expect(splitMarkers("", ru)).toEqual([]);
  });
});

describe("номера картинок поля и снятие метки", () => {
  it("номера идут по порядку меток, повтор метки — один номер", () => {
    expect(markerNumbers("[картинка 2] текст [картинка 1] и снова [картинка 2]", ru)).toEqual([2, 1]);
    expect(markerNumbers("без меток", ru)).toEqual([]);
  });

  it("снятая метка уходит из текста вместе с одним пробелом рядом, другие метки остаются", () => {
    expect(withoutMarker("Шапка [картинка 1] съехала", 1, ru)).toBe("Шапка съехала");
    expect(withoutMarker("[картинка 1] [картинка 2]", 1, ru)).toBe("[картинка 2]");
    expect(withoutMarker("смотри [картинка 2]", 2, ru)).toBe("смотри");
    expect(withoutMarker("[картинка 12] и [картинка 1]", 1, ru)).toBe("[картинка 12] и");
  });

  it("каждое вхождение метки снимается", () => {
    expect(markerNumbers(withoutMarker("[картинка 3] а [картинка 3] б", 3, ru), ru)).toEqual([]);
  });
});
