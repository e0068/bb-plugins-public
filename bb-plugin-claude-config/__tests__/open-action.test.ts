import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_OPENER,
  isHostOpen,
  normalizeOpener,
} from "../src/open-action";

describe("normalizeOpener", () => {
  it("passes the three valid modes through as-is", () => {
    expect(normalizeOpener("md-opener")).toBe("md-opener");
    expect(normalizeOpener("builtin")).toBe("builtin");
    expect(normalizeOpener("host")).toBe("host");
  });

  it("undefined and garbage fall back to the md-opener default", () => {
    expect(normalizeOpener(undefined)).toBe(DEFAULT_FILE_OPENER);
    expect(normalizeOpener("md-opener")).toBe(DEFAULT_FILE_OPENER);
    expect(normalizeOpener("random")).toBe("md-opener");
    expect(normalizeOpener(42)).toBe("md-opener");
  });
});

describe("isHostOpen", () => {
  it("only host goes to the host tab", () => {
    expect(isHostOpen("host")).toBe(true);
    expect(isHostOpen("md-opener")).toBe(false);
    expect(isHostOpen("builtin")).toBe(false);
  });

  it("the default (no setting) opens in the column, not the host", () => {
    expect(isHostOpen(undefined)).toBe(false);
  });
});
