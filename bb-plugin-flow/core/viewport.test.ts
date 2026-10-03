// @vitest-environment node
import { describe, expect, it } from "vitest";

import { withoutAutoZoom } from "./viewport";

describe("тег viewport без автозума на фокусе поля", () => {
  it("к тегу bb дописывается maximum-scale=1, остальное остаётся как было", () => {
    expect(withoutAutoZoom("width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content")).toBe(
      "width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content, maximum-scale=1",
    );
  });

  it("другой предел масштаба заменяется на 1", () => {
    expect(withoutAutoZoom("width=device-width, maximum-scale=5")).toBe("width=device-width, maximum-scale=1");
  });

  it("тег, который уже держит предел 1, не меняется", () => {
    const content = "width=device-width,maximum-scale=1";
    expect(withoutAutoZoom(content)).toBe(content);
    expect(withoutAutoZoom(withoutAutoZoom("width=device-width"))).toBe(withoutAutoZoom("width=device-width"));
  });

  it("пустой тег получает только предел", () => {
    expect(withoutAutoZoom("")).toBe("maximum-scale=1");
  });
});
