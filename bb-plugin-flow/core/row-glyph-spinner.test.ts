// @vitest-environment node
import { describe, expect, it } from "vitest";

import { glyphCss } from "./row-glyph-css";

const LOGO = "/api/v1/system/providers/claude-code/logo?h=1";
const rulesOf = (css: string, threadId: string) => css.split("\n").filter((r) => r.includes(`a[data-sidebar-thread-id="${threadId}"]`));

describe("логотип агента вместо колёсика хода", () => {
  it("колёсико в строке треда рисуется логотипом его провайдера цветом строки, а своё вращение хоста остаётся", () => {
    const [rule, hide] = rulesOf(glyphCss([], [{ threadId: "thr_a", logoUrl: LOGO }]), "thr_a");
    expect(rule).toContain('[data-sidebar-thread-trailing-indicator] > [data-icon="Loading"]{');
    expect(rule).toContain("background-color:currentColor");
    expect(rule).toContain(`mask-image:url("${LOGO}")`);
    expect(rule).not.toMatch(/animation|transform/);
    expect(hide).toMatch(/>\*\{display:none\}$/);
  });

  it("у каждого треда своё правило — чужие строки не задеты", () => {
    const css = glyphCss([], [{ threadId: "thr_a", logoUrl: LOGO }, { threadId: "thr_b", logoUrl: "/codex" }]);
    expect(rulesOf(css, "thr_a")[0]).toContain(LOGO);
    expect(rulesOf(css, "thr_b")[0]).toContain('url("/codex")');
    expect(rulesOf(css, "thr_c")).toEqual([]);
  });

  it("кавычка в id треда или в адресе логотипа не ломает правило", () => {
    const css = glyphCss([], [{ threadId: 'a"b', logoUrl: 'x"y' }]);
    expect(css).toContain('a[data-sidebar-thread-id="a\\"b"]');
    expect(css).toContain('url("x%22y")');
  });

  it("без логотипов колёсико не трогается", () => {
    expect(glyphCss([], [])).not.toContain("Loading");
  });
});
