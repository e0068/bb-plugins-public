// @vitest-environment node
import { describe, expect, it } from "vitest";

import { MUTED_BLINK } from "./muted-blink";
import { glyphCss } from "./row-glyph-css";

describe("CSS маски значков строки треда", () => {
  it("по подписи — маска рисунком цветом текста и скрытие путей хоста", () => {
    const css = glyphCss([{ label: "Flow — Вопросы", svg: '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>' }]);
    const target = '[data-sidebar-thread-trailing-indicator] [aria-label="Flow — Вопросы"]';
    expect(css).toContain(`${target}{background-color:currentColor;`);
    expect(css).toContain("mask-image:url(\"data:image/svg+xml,");
    expect(css).toContain(encodeURIComponent('<path d="M1 1"/>'));
    expect(css).toContain(`${target}>*{display:none}`);
  });

  it("кавычка в подписи экранируется, пустой список — пустой CSS", () => {
    expect(glyphCss([{ label: 'a"b', svg: "<svg/>" }])).toContain('[aria-label="a\\"b"]');
    expect(glyphCss([])).toBe("");
  });
});

describe("мигание значка строки треда", () => {
  it("мигающий значок получает анимацию и её кадры, ровный — нет", () => {
    const css = glyphCss([
      { label: "Flow — идёт", svg: "<svg/>", blink: true },
      { label: "Flow — ждёт", svg: "<svg/>" },
    ]);
    const rules = css.split("\n");
    expect(rules.find((r) => r.includes('[aria-label="Flow — идёт"]{'))).toMatch(new RegExp(`animation:${MUTED_BLINK} `));
    expect(rules.find((r) => r.includes('[aria-label="Flow — ждёт"]{'))).not.toMatch(/animation:/);
    expect(css).toContain(`@keyframes ${MUTED_BLINK}`);
  });

  it("без мигающих значков кадров мерцания в стиле нет", () => {
    expect(glyphCss([{ label: "Flow — ждёт", svg: "<svg/>" }])).not.toContain("@keyframes");
  });
});
