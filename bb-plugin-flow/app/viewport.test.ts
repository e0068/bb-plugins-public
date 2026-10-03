// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { lockAutoZoom } from "./viewport";

describe("тег viewport страницы bb", () => {
  it("получает предел масштаба 1, и iPhone не приближает страницу на фокусе поля", () => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
    lockAutoZoom(document);
    expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content).toBe("width=device-width, initial-scale=1.0, maximum-scale=1");
  });

  it("страница без тега остаётся без тега", () => {
    document.head.innerHTML = "";
    lockAutoZoom(document);
    expect(document.head.innerHTML).toBe("");
  });
});
