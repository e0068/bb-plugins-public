// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tasksRpcContract } from "./contract.js";

const update = (dates: Record<string, string>) =>
  tasksRpcContract.updateTask.input.safeParse({ taskId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", ...dates }).success;

describe("plan dates over RPC", () => {
  it("take a day or a day with a time", () => {
    expect(update({ startDate: "2026-10-01", dueDate: "2026-10-01T15:45" })).toBe(true);
  });

  it("refuse a time past 23:59", () => {
    expect(update({ dueDate: "2026-10-01T25:00" })).toBe(false);
  });
});
