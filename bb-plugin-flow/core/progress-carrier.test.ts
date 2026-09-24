import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { carriedBy, carrierOf, forHandoff } from "./progress";
import type { FlowProgress } from "../shared/contract";

const record: FlowProgress = {
  stages: { spec: { startedAt: "2026-09-23T10:00:00.000Z", finishedAt: "2026-09-23T10:10:00.000Z" }, demo: { startedAt: "2026-09-23T11:00:00.000Z" } },
  waiting: ["demo"],
  planned: { minutes: 50, target: 10, max: 20 },
  lastBriefId: "dec_1",
};

describe("носитель прогона", () => {
  it("у записи без носителя прогон ведёт тред, под чьим адресом она лежит", () => {
    expect(carrierOf(record, "thr_a")).toBe("thr_a");
  });

  it("переданный прогон ведёт тред, которому его передали", () => {
    expect(carrierOf(carriedBy(record, "thr_b"), "thr_a")).toBe("thr_b");
  });

  it("смена носителя не трогает ни этапов, ни ожидания, ни плана", () => {
    const { thread, ...rest } = carriedBy(record, "thr_b");
    expect(thread).toBe("thr_b");
    expect(rest).toEqual(record);
  });

  it("сброс этапов при передаче не зависит от того, кто понесёт прогон дальше", () => {
    const run = [{ id: "demo", run: true, executor: "self" }];
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (to) => {
        const { thread, ...rest } = carriedBy(forHandoff(record, run), to);
        expect(thread).toBe(to);
        expect(rest).toEqual(forHandoff(record, run));
      }),
    );
  });
});
