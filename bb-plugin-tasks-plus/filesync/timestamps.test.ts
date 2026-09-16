import { describe, expect, it } from "vitest";
import { taskTimestamps } from "./timestamps.js";

const BORN = Date.UTC(2026, 0, 2, 3, 4, 5);
const CHANGED = Date.UTC(2026, 5, 6, 7, 8, 9);

describe("taskTimestamps", () => {
  it("takes creation from birth time and change from modification time", () => {
    expect(taskTimestamps({ birthtimeMs: BORN, mtimeMs: CHANGED })).toEqual({
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-06-06T07:08:09.000Z",
    });
  });

  it("falls back to the modification time when there is no birth time", () => {
    const times = taskTimestamps({ birthtimeMs: 0, mtimeMs: CHANGED });
    expect(times.createdAt).toBe(times.updatedAt);
  });

  it("falls back when the file was born after the content it carries", () => {
    const times = taskTimestamps({ birthtimeMs: CHANGED + 1000, mtimeMs: CHANGED });
    expect(times.createdAt).toBe(times.updatedAt);
  });

  it("keeps both times equal for a file written once and never touched", () => {
    const times = taskTimestamps({ birthtimeMs: CHANGED, mtimeMs: CHANGED });
    expect(times.createdAt).toBe(times.updatedAt);
  });

  it("never reports a creation later than the last change", () => {
    const samples: [number, number][] = [
      [0, 1],
      [BORN, CHANGED],
      [CHANGED, BORN],
      [CHANGED, CHANGED],
      [1, 1],
    ];
    for (const [birthtimeMs, mtimeMs] of samples) {
      const times = taskTimestamps({ birthtimeMs, mtimeMs });
      expect(Date.parse(times.createdAt)).toBeLessThanOrEqual(
        Date.parse(times.updatedAt),
      );
    }
  });
});
