import { describe, expect, it } from "vitest";
import { formatFileSize, formatRelativeTime } from "./format";

const NOW = Date.parse("2026-07-22T12:00:00Z");
const at = (agoMs: number): string => new Date(NOW - agoMs).toISOString();

describe("formatRelativeTime", () => {
  it("steps through minutes, hours and days", () => {
    expect(formatRelativeTime(at(20_000), NOW)).toBe("just now");
    expect(formatRelativeTime(at(5 * 60_000), NOW)).toBe("5m ago");
    expect(formatRelativeTime(at(59 * 60_000), NOW)).toBe("59m ago");
    expect(formatRelativeTime(at(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(formatRelativeTime(at(50 * 3_600_000), NOW)).toBe("2d ago");
    expect(formatRelativeTime(at(29 * 86_400_000), NOW)).toBe("29d ago");
  });

  it("switches to the date with 24-hour hours and minutes from 30 days on, the year outside now's", () => {
    expect(formatRelativeTime(new Date(2026, 5, 1, 14, 34).toISOString(), NOW)).toBe("Jun 1, 14:34");
    expect(formatRelativeTime(new Date(2025, 8, 4, 9, 5).toISOString(), NOW)).toBe("Sep 4, 2025, 09:05");
  });

  it("treats a timestamp in the future as just now", () => {
    expect(formatRelativeTime(at(-90_000), NOW)).toBe("just now");
  });

  it("renders nothing for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("formatFileSize", () => {
  it("picks the unit by magnitude", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(204 * 1024)).toBe("204 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
