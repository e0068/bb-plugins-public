import { describe, expect, it } from "vitest";
import {
  BLINK_ANIMATION,
  BUSY_OVERRIDE_ATTR,
  busyOverrideCss,
  HOST_QUESTION_ICON,
} from "./busy-override-css";

describe("busyOverrideCss", () => {
  const css = busyOverrideCss();

  it("scopes every rule to a busy-marked row's trailing-indicator slot", () => {
    for (const line of css.split("\n")) {
      if (line.startsWith("@keyframes")) continue;
      expect(line).toContain(`[${BUSY_OVERRIDE_ATTR}]`);
      expect(line).toContain("[data-sidebar-thread-trailing-indicator]");
    }
  });

  it("masks the host's own question mark, not some glyph of our own", () => {
    expect(css).toContain(`[data-icon="${HOST_QUESTION_ICON}"]`);
  });

  it("draws the replacement as a mask over currentColor, in both spellings", () => {
    expect(css).toContain("background-color:currentColor");
    expect(css).toContain("mask-image:url(");
    expect(css).toContain("-webkit-mask-image:url(");
  });

  it("hides the host's own question-mark path underneath the mask", () => {
    expect(css).toContain(`[data-icon="${HOST_QUESTION_ICON}"]>*{display:none}`);
  });

  it("defines the blink and applies it — but only where motion is welcome", () => {
    expect(css).toContain(`@keyframes ${BLINK_ANIMATION}`);
    expect(css).toContain("prefers-reduced-motion:no-preference");
    expect(css).toContain(`animation:${BLINK_ANIMATION}`);
  });

  it("the blink animation lives behind the reduced-motion guard, not in the base rule", () => {
    const guard = css.indexOf("prefers-reduced-motion");
    expect(css.indexOf(`animation:${BLINK_ANIMATION}`)).toBeGreaterThan(guard);
  });
});
