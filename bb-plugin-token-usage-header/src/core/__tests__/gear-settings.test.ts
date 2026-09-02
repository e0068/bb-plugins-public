import { describe, expect, it } from "vitest";
import { DEFAULT_GEAR_SETTINGS, parseGearSettings } from "../gear-settings";

describe("parseGearSettings", () => {
  it("returns full defaults for undefined (host still loading)", () => {
    expect(parseGearSettings(undefined)).toEqual(DEFAULT_GEAR_SETTINGS);
  });

  it("returns full defaults for an empty object", () => {
    expect(parseGearSettings({})).toEqual(DEFAULT_GEAR_SETTINGS);
  });

  it("parses a fully specified, in-range values object", () => {
    const result = parseGearSettings({
      unit: "300",
      fillWidthFeed: false,
      fillWidthPopover: true,
      fillWidthSession: false,
      hugWidth: true,
      contentFullWidth: true,
      contentMaxWidthPx: "2000",
      heightMode: "perCard",
      collapseEmpty: true,
      colWidthPx: "20",
      heightScale: "2",
      colGap: "4",
      segGap: "2",
      colRadius: "3",
      segRadius: "3",
      frameLiftColor: "#abcdef",
    });

    expect(result).toEqual({
      unit: 300,
      fillWidthFeed: false,
      fillWidthPopover: true,
      fillWidthSession: false,
      hugWidth: true,
      contentFullWidth: true,
      contentMaxWidthPx: 2000,
      heightMode: "perCard",
      collapseEmpty: true,
      colWidthPx: 20,
      heightScale: 2,
      colGap: 4,
      segGap: 2,
      colRadius: 3,
      segRadius: 3,
      frameLiftColor: "#abcdef",
    });
  });

  it("falls back to default for a non-numeric numeric field", () => {
    expect(parseGearSettings({ colWidthPx: "wide" }).colWidthPx).toBe(DEFAULT_GEAR_SETTINGS.colWidthPx);
  });

  it("falls back to default for a boolean field carrying a string", () => {
    expect(parseGearSettings({ fillWidthFeed: "true" }).fillWidthFeed).toBe(DEFAULT_GEAR_SETTINGS.fillWidthFeed);
  });

  it("falls back to default for a heightMode outside the enum", () => {
    expect(parseGearSettings({ heightMode: "bogus" }).heightMode).toBe(DEFAULT_GEAR_SETTINGS.heightMode);
  });

  it("falls back to default for a non-hex frameLiftColor", () => {
    expect(parseGearSettings({ frameLiftColor: "blue" }).frameLiftColor).toBe(DEFAULT_GEAR_SETTINGS.frameLiftColor);
  });

  it("accepts a 3-digit hex frameLiftColor", () => {
    expect(parseGearSettings({ frameLiftColor: "#abc" }).frameLiftColor).toBe("#abc");
  });

  it("clamps colWidthPx below its 1px minimum up to the minimum", () => {
    expect(parseGearSettings({ colWidthPx: "0" }).colWidthPx).toBe(1);
  });

  it("clamps colWidthPx above its 40px maximum down to the maximum", () => {
    expect(parseGearSettings({ colWidthPx: "999" }).colWidthPx).toBe(40);
  });

  it("clamps heightScale to its [0.3, 3] range", () => {
    expect(parseGearSettings({ heightScale: "0" }).heightScale).toBe(0.3);
    expect(parseGearSettings({ heightScale: "10" }).heightScale).toBe(3);
  });

  it("clamps contentMaxWidthPx to its [600, 4000] range", () => {
    expect(parseGearSettings({ contentMaxWidthPx: "100" }).contentMaxWidthPx).toBe(600);
    expect(parseGearSettings({ contentMaxWidthPx: "9000" }).contentMaxWidthPx).toBe(4000);
  });

  it("accepts colWidthPx exactly at its bounds (1 and 40)", () => {
    expect(parseGearSettings({ colWidthPx: "1" }).colWidthPx).toBe(1);
    expect(parseGearSettings({ colWidthPx: "40" }).colWidthPx).toBe(40);
  });

  it("returns a fresh object each call, not a shared reference", () => {
    const a = parseGearSettings(undefined);
    const b = parseGearSettings(undefined);

    expect(a).not.toBe(b);
    expect(a).not.toBe(DEFAULT_GEAR_SETTINGS);
  });
});
