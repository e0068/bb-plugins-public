import { describe, expect, it, vi } from "vitest";
import { planned } from "../test-support/planned.js";

const retryPath = "./write-retry.js";
const repoPath = "./task-repo.js";
const { retryOnConflict, TaskWriteConflict } = await planned<typeof import("./write-retry.js")>(() => import(/* @vite-ignore */ retryPath));
const { WriteConflict } = await planned<typeof import("./task-repo.js")>(() => import(/* @vite-ignore */ repoPath));

/** A write that loses a race is redone from a fresh read — a few times, then the loser hears about it. */
describe("retryOnConflict", () => {
  it("runs a write that lands once and never resyncs", async () => {
    const resync = vi.fn(async () => {});
    expect(await retryOnConflict(async () => "done", resync)).toBe("done");
    expect(resync).not.toHaveBeenCalled();
  });

  it("resyncs and runs again after each conflict, and returns what the landing run returned", async () => {
    const resync = vi.fn(async () => {});
    let runs = 0;
    const result = await retryOnConflict(async () => {
      runs += 1;
      if (runs < 3) throw new WriteConflict("version");
      return runs;
    }, resync);
    expect(result).toBe(3);
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it("gives up after three runs with a task_write_conflict", async () => {
    const run = vi.fn(async () => {
      throw new WriteConflict("key");
    });
    const error = await retryOnConflict(run, async () => {}).then(
      () => expect.fail("expected the write to give up"),
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TaskWriteConflict);
    expect((error as { code: string }).code).toBe("task_write_conflict");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("passes any other failure through at once", async () => {
    const resync = vi.fn(async () => {});
    const boom = new Error("disk full");
    const run = vi.fn(async () => {
      throw boom;
    });
    await expect(retryOnConflict(run, resync)).rejects.toBe(boom);
    expect(run).toHaveBeenCalledTimes(1);
    expect(resync).not.toHaveBeenCalled();
  });
});
