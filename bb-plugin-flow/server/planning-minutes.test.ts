// @vitest-environment node
import { describe, expect, it } from "vitest";

import { readWindowMinutes, type PlanningSource } from "./planning";

const at = (timestamp: string) => JSON.stringify({ type: "assistant", timestamp, requestId: "r", message: { id: "m" } });

const IDENTITY = [{ type: "thread/identity", data: { providerThreadId: "sess-1" } }];

const source = (identity: unknown[] = IDENTITY): PlanningSource => ({
  threads: { get: async () => ({ createdAt: 0 }) as never, events: { list: async () => identity as never } },
});

const WINDOWS = [
  { from: Date.parse("2026-09-16T10:00:00.000Z"), to: Date.parse("2026-09-16T10:20:00.000Z") },
  { from: Date.parse("2026-09-16T11:00:00.000Z"), to: Date.parse("2026-09-16T11:20:00.000Z") },
];

describe("активные минуты окон треда", () => {
  it("минуты каждого окна считаются одним чтением лога", async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return [at("2026-09-16T10:01:00.000Z"), at("2026-09-16T10:01:30.000Z"), at("2026-09-16T11:05:00.000Z"), at("2026-09-16T11:06:00.000Z"), at("2026-09-16T11:07:00.000Z")];
    };
    expect(await readWindowMinutes(source(), "thr_1", WINDOWS, read)).toEqual([1, 3]);
    expect(reads).toBe(1);
  });

  it("лога сессии нет или сессий нет — нули, а не пустой ответ", async () => {
    expect(await readWindowMinutes(source(), "thr_1", WINDOWS, async () => undefined)).toEqual([0, 0]);
    expect(await readWindowMinutes(source([]), "thr_1", WINDOWS, async () => [at("2026-09-16T10:01:00.000Z")])).toEqual([0, 0]);
  });

  it("сбой чтения событий треда уходит наружу: «не прочиталось» не то же, что «записей нет»", async () => {
    const broken: PlanningSource = { threads: { get: async () => ({ createdAt: 0 }) as never, events: { list: async () => { throw new Error("down"); } } } };
    await expect(readWindowMinutes(broken, "thr_1", WINDOWS, async () => [])).rejects.toThrow("down");
  });
});
