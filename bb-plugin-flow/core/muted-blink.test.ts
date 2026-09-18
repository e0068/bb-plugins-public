// @vitest-environment node
import { describe, expect, it } from "vitest";

import { glyphCss } from "./row-glyph-css";
import { MUTED_BLINK, mutedBlinkKeyframes } from "./muted-blink";

const opacities = (css: string): number[] => [...css.matchAll(/opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));

describe("приглушённое мерцание", () => {
  it("самое яркое состояние на треть тусклее полной яркости, самое тусклое — около 0,3", () => {
    const values = opacities(mutedBlinkKeyframes);
    expect(Math.max(...values)).toBeCloseTo(0.67, 2);
    expect(Math.min(...values)).toBeCloseTo(0.3, 2);
  });

  it("кадры начинаются и кончаются на пике: полной яркости между циклами нет", () => {
    expect(mutedBlinkKeyframes).toMatch(new RegExp(`@keyframes ${MUTED_BLINK}\\{0%,100%\\{opacity:\\.67\\}`));
  });

  it("мигающий значок строки треда мерцает теми же кадрами", () => {
    const css = glyphCss([{ label: "Flow — идёт", svg: "<svg/>", blink: true }]);
    expect(css).toContain(mutedBlinkKeyframes);
    expect(css).toContain(`animation:${MUTED_BLINK} `);
    expect(Math.max(...opacities(css))).toBeCloseTo(0.67, 2);
  });
});
