import { describe, expect, it, vi } from "vitest";
import { singleFlight } from "../single-flight";

/** A run that finishes only when the test says so. */
function gatedRun<T>(value: T) {
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const run = vi.fn(async () => {
    await gate;
    return value;
  });
  return { run, finish };
}

describe("singleFlight", () => {
  it("runs once for callers that arrive while it is still running, and gives them all its result", async () => {
    const { run, finish } = gatedRun("scan");
    const once = singleFlight(run);

    const calls = [once(), once(), once()];
    finish();

    expect(await Promise.all(calls)).toEqual(["scan", "scan", "scan"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs anew for a caller that arrives after the run has finished", async () => {
    const run = vi.fn(async () => "scan");
    const once = singleFlight(run);

    await once();
    await once();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs anew after a failed run, and every caller of the failed one sees the failure", async () => {
    let attempt = 0;
    const run = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("daemon unreachable");
      return "scan";
    });
    const once = singleFlight(run);

    const failed = [once(), once()];
    await expect(Promise.all(failed)).rejects.toThrow("daemon unreachable");
    expect(await once()).toBe("scan");
  });
});
