// @vitest-environment node
import { describe, expect, it } from "vitest";

import { splitMarkers } from "./image-markers";

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
