// @vitest-environment jsdom
// Разметка левой панели bb: признак строки `data-sidebar-rename-row` стоит и на строке треда, и на обёртке группы,
// внутри которой лежат строки всех её тредов.
import { describe, expect, it } from "vitest";

import { glyphCss } from "./row-glyph-css";

const CLAUDE = "/api/v1/system/providers/claude-code/logo";
const CODEX = "/api/v1/system/providers/codex/logo";
const PI = "/api/v1/system/providers/pi/logo";

const row = (threadId: string): string =>
  `<div data-sidebar-rename-row><span><a data-sidebar-thread-id="${threadId}" data-sidebar-rename-anchor>${threadId}</a></span>` +
  `<span data-sidebar-thread-trailing><span><span><span><span data-sidebar-thread-trailing-indicator><svg data-icon="Loading" id="spin-${threadId}"></svg></span></span></span></span></span></div>`;

const group = (...threadIds: string[]): string => `<div data-sidebar-rename-row data-sidebar-section-id="g"><span>Группа</span><div>${threadIds.map(row).join("")}</div></div>`;

/** Логотипы, правила которых ложатся на колёсико треда; рисуется последнее совпавшее. */
const logosOn = (css: string, threadId: string): string[] => {
  const spinner = document.getElementById(`spin-${threadId}`)!;
  return css
    .split("\n")
    .filter((rule) => rule.includes("mask-image"))
    .filter((rule) => spinner.matches(rule.slice(0, rule.indexOf("{"))))
    .map((rule) => rule.match(/mask-image:url\("([^"]+)"\)/)![1]!);
};

describe("логотип колёсика в группе тредов", () => {
  it("колёсико треда получает только логотип своего провайдера, а не соседа по группе", () => {
    document.body.innerHTML = group("thr_claude", "thr_codex", "thr_pi");
    const css = glyphCss([], [{ threadId: "thr_codex", logoUrl: CODEX }, { threadId: "thr_pi", logoUrl: PI }, { threadId: "thr_claude", logoUrl: CLAUDE }]);
    expect(logosOn(css, "thr_codex")).toEqual([CODEX]);
    expect(logosOn(css, "thr_pi")).toEqual([PI]);
    expect(logosOn(css, "thr_claude")).toEqual([CLAUDE]);
  });

  it("тред без логотипа в группе с чужими логотипами крутит обычное колёсико хоста", () => {
    document.body.innerHTML = group("thr_claude", "thr_plain");
    expect(logosOn(glyphCss([], [{ threadId: "thr_claude", logoUrl: CLAUDE }]), "thr_plain")).toEqual([]);
  });
});
