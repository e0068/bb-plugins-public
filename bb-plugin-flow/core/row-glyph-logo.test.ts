// @vitest-environment node
import { describe, expect, it } from "vitest";

import { glyphCss } from "./row-glyph-css";

const LOGO = "/api/v1/system/providers/claude-code/logo?h=1";
const ruleOf = (css: string, label: string) => css.split("\n").find((r) => r.includes(`[aria-label="${label}"]{`)) ?? "";

describe("логотип провайдера в строке треда", () => {
  it("этап самого агента — логотип провайдера маской цветом строки, без рисунка значка", () => {
    const rule = ruleOf(glyphCss([{ label: "Flow — Сам · Claude Code · идёт", svg: "<svg>diamond</svg>", logo: { url: LOGO, framed: false } }]), "Flow — Сам · Claude Code · идёт");
    expect(rule).toContain("background-color:currentColor");
    expect(rule).toContain(`mask-image:url("${LOGO}")`);
    expect(rule).not.toContain(encodeURIComponent("diamond"));
  });

  it("субагент — два слоя маски: контурный квадрат во весь значок и логотип меньше внутри", () => {
    const rule = ruleOf(glyphCss([{ label: "Flow — Агент · Claude Code · идёт", svg: "<svg/>", logo: { url: LOGO, framed: true } }]), "Flow — Агент · Claude Code · идёт");
    const layers = /(?:^|;)mask-image:([^;]+)/.exec(rule)![1]!;
    expect(layers.split("),").length).toBe(2);
    expect(layers).toContain("data:image/svg+xml");
    expect(decodeURIComponent(layers)).toMatch(/<rect[^>]*stroke=/);
    expect(layers).toContain(`url("${LOGO}")`);
    const size = /(?:^|;)mask-size:([^;]+)/.exec(rule)![1]!.split(",").map((s) => s.trim());
    expect(size[0]).toBe("contain");
    expect(Number.parseFloat(size[1]!)).toBeLessThanOrEqual(55);
  });

  it("кавычка в адресе логотипа не ломает правило", () => {
    expect(glyphCss([{ label: "x", svg: "<svg/>", logo: { url: 'a"b', framed: false } }])).toContain('url("a%22b")');
  });
});
