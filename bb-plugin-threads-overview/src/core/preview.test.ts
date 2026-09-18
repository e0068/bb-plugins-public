import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_DELAY_SECONDS,
  MAX_PREVIEW_DELAY_SECONDS,
  parsePreviewDelayMs,
} from "./preview";

describe("parsePreviewDelayMs", () => {
  it("reads whole seconds as milliseconds", () => {
    expect(parsePreviewDelayMs("2")).toBe(2000);
  });

  it("reads fractions of a second too", () => {
    expect(parsePreviewDelayMs("0.5")).toBe(500);
  });

  it("treats zero as off", () => {
    expect(parsePreviewDelayMs("0")).toBe(0);
  });

  it("falls back to the default when the setting was never set", () => {
    expect(parsePreviewDelayMs(undefined)).toBe(
      DEFAULT_PREVIEW_DELAY_SECONDS * 1000,
    );
  });

  it.each([["", "empty"], ["позже", "words"], ["  ", "blank"]])(
    "falls back to the default on %s input",
    (raw) => {
      expect(parsePreviewDelayMs(raw)).toBe(DEFAULT_PREVIEW_DELAY_SECONDS * 1000);
    },
  );

  it("reads a number, which is what a host that keeps types hands over", () => {
    expect(parsePreviewDelayMs(2)).toBe(2000);
  });

  it("falls back to the default when the host hands over a boolean", () => {
    expect(parsePreviewDelayMs(true)).toBe(DEFAULT_PREVIEW_DELAY_SECONDS * 1000);
  });

  it("reads a negative delay as off rather than as the default", () => {
    expect(parsePreviewDelayMs("-3")).toBe(0);
  });

  it("caps a delay nobody would wait out", () => {
    expect(parsePreviewDelayMs("9000")).toBe(MAX_PREVIEW_DELAY_SECONDS * 1000);
  });
});
