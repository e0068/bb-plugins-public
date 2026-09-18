import { describe, expect, it } from "vitest";
import { PREVIEW_SIZE_BOUNDS, parsePreviewSize } from "./preview-size";

const { width, height } = PREVIEW_SIZE_BOUNDS;

describe("parsePreviewSize", () => {
  it("reads the width and the height in pixels", () => {
    expect(parsePreviewSize("640", "480")).toEqual({ width: 640, height: 480 });
  });

  it("takes the default for a setting never set, blank or unreadable", () => {
    expect(parsePreviewSize(undefined, "")).toEqual({
      width: width.default,
      height: height.default,
    });
    expect(parsePreviewSize("wide", true)).toEqual({
      width: width.default,
      height: height.default,
    });
  });

  it("keeps a window too small to read or larger than any screen within bounds", () => {
    expect(parsePreviewSize("10", "10")).toEqual({ width: width.min, height: height.min });
    expect(parsePreviewSize("99999", "99999")).toEqual({ width: width.max, height: height.max });
  });

  it("rounds a fractional size to whole pixels and reads a number the host kept as is", () => {
    expect(parsePreviewSize("600.6", 500)).toEqual({ width: 601, height: 500 });
  });
});
