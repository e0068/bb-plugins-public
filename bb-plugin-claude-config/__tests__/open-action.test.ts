import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_OPENER,
  isHostOpen,
  normalizeOpener,
} from "../src/open-action";

describe("normalizeOpener", () => {
  it("пропускает три валидных режима как есть", () => {
    expect(normalizeOpener("md-opener")).toBe("md-opener");
    expect(normalizeOpener("builtin")).toBe("builtin");
    expect(normalizeOpener("host")).toBe("host");
  });

  it("undefined и мусор падают на дефолт md-opener", () => {
    expect(normalizeOpener(undefined)).toBe(DEFAULT_FILE_OPENER);
    expect(normalizeOpener("md-opener")).toBe(DEFAULT_FILE_OPENER);
    expect(normalizeOpener("наугад")).toBe("md-opener");
    expect(normalizeOpener(42)).toBe("md-opener");
  });
});

describe("isHostOpen", () => {
  it("только host уходит в хостовую вкладку", () => {
    expect(isHostOpen("host")).toBe(true);
    expect(isHostOpen("md-opener")).toBe(false);
    expect(isHostOpen("builtin")).toBe(false);
  });

  it("дефолт (пустая настройка) открывает в колонке, не в хосте", () => {
    expect(isHostOpen(undefined)).toBe(false);
  });
});
