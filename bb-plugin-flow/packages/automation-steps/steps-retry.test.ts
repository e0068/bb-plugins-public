import { describe, expect, it } from "vitest";

import { createSteps, retrying, type StepOutcome, type StepPorts } from "./steps";
import type { PluginsPort } from "./wiring/plugin-reinstall";

const kv = () => {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key: string, value: unknown) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
    list: async () => [...data.keys()],
  };
};

const plugins: PluginsPort = {
  list: async () => ({ plugins: [] }),
  applyUpdate: async () => ({}) as never,
  install: async () => ({}) as never,
  remove: async () => ({}) as never,
};

/** Шаг по сценарию: на каждый вызов отдаёт следующий итог. */
const scripted = (outcomes: readonly StepOutcome[]) => {
  let call = 0;
  return { run: async () => outcomes[Math.min(call++, outcomes.length - 1)]!, calls: () => call };
};

const paused: { slept: number[]; sleep: (ms: number) => Promise<void> } = {
  slept: [],
  sleep: async (ms) => void paused.slept.push(ms),
};

describe("retrying", () => {
  it("временная ошибка повторяется, и успех называет номер попытки", async () => {
    const slept: number[] = [];
    const step = scripted([{ ok: false, error: "HTTP 502" }, { ok: false, error: "fetch failed" }, { ok: true, detail: "merged" }]);
    const outcome = await retrying(async (ms) => void slept.push(ms), step.run)("t1");
    expect(outcome).toEqual({ ok: true, detail: "merged; succeeded on attempt 3" });
    expect(step.calls()).toBe(3);
    expect(slept).toEqual([2_000, 8_000]);
  });

  it("успех с первой попытки не приписывает ничего", async () => {
    const outcome = await retrying(paused.sleep, scripted([{ ok: true, detail: null }]).run)("t1");
    expect(outcome).toEqual({ ok: true, detail: null });
  });

  it("постоянная ошибка не повторяется вовсе", async () => {
    const slept: number[] = [];
    const step = scripted([{ ok: false, error: "No GitHub token: gh is not authorized" }]);
    const outcome = await retrying(async (ms) => void slept.push(ms), step.run)("t1");
    expect(outcome).toEqual({ ok: false, error: "No GitHub token: gh is not authorized" });
    expect(step.calls()).toBe(1);
    expect(slept).toEqual([]);
  });

  it("временная ошибка, не прошедшая за все попытки, называет их число", async () => {
    const step = scripted([{ ok: false, error: "HTTP 503" }]);
    const outcome = await retrying(paused.sleep, step.run)("t1");
    expect(outcome).toEqual({ ok: false, error: "HTTP 503 (3 attempts)" });
    expect(step.calls()).toBe(3);
  });
});

describe("createSteps с повторами", () => {
  it("шаг, упавший временно, повторяется самим набором шагов", async () => {
    let calls = 0;
    const slept: number[] = [];
    const sdk = {
      threads: {
        get: async () => ({ id: "t1", environmentId: "e1", title: "T" }),
        archive: async () => {
          calls += 1;
          if (calls < 3) throw new Error("HTTP 500: Internal Server Error");
          return {};
        },
      },
      environments: { get: async () => ({ id: "e1", hostId: "h", path: null, branchName: "b", baseBranch: "main" }) },
    } as unknown as StepPorts["sdk"];
    const steps = createSteps({ sdk, kv: kv(), settings: { get: async () => ({ githubToken: "token" }) }, plugins, ownPluginId: "flow", sleep: async (ms) => void slept.push(ms) });
    expect(await steps["bb.archive"]("t1")).toEqual({ ok: true, detail: "succeeded on attempt 3" });
    expect(slept).toEqual([2_000, 8_000]);
  });
});
