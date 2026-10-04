import { describe, expect, it } from "vitest";

import { createSteps, type StepPorts } from "./steps";
import type { CliPorts, CliRun } from "./wiring/bb-cli-run";

const UNREACHABLE = "The board's database cannot be reached — the task was not changed.";
const REFUSED = "The board's database refused its token — the task was not changed.";

const ran = (stdout: string, code = 0, stderr = ""): CliRun => ({ kind: "ran", code, stdout, stderr });

/** CLI доски: список задач треда отдаёт SHA-54, а запись статуса — по сценарию, по одному ответу на вызов. */
const board = (writes: readonly CliRun[]) => {
  let written = 0;
  const cli: CliPorts = {
    run: async (args) => (args[1] === "current" ? ran(JSON.stringify({ tasks: [{ key: "SHA-54" }] })) : writes[Math.min(written++, writes.length - 1)]!),
  };
  return { cli, writes: () => written };
};

/** Шагу «Задача → done» нужны только CLI и пауза: остальные порты он не трогает. */
const stepsOver = (cli: CliPorts, slept: number[]) =>
  createSteps({ cli, sleep: async (ms) => void slept.push(ms) } as unknown as StepPorts);

describe("шаг «Задача → done» и облачная база доски", () => {
  it("первая запись не дошла до базы, вторая прошла — шаг зелёный и называет задачу", async () => {
    const slept: number[] = [];
    const { cli, writes } = board([ran("", 1, UNREACHABLE), ran("{}")]);
    const outcome = await stepsOver(cli, slept)["bb.tasks-done"]("t1");
    expect(outcome).toEqual({ ok: true, detail: "SHA-54; succeeded on attempt 2" });
    expect(writes()).toBe(2);
    expect(slept).toEqual([2_000]);
  });

  it("база молчит все три раза — шаг красный и называет число попыток", async () => {
    const { cli, writes } = board([ran("", 1, UNREACHABLE)]);
    const outcome = await stepsOver(cli, [])["bb.tasks-done"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("(3 attempts)") });
    expect(writes()).toBe(3);
  });

  it("база отказала по токену — шаг красный сразу, повтора нет", async () => {
    const slept: number[] = [];
    const { cli, writes } = board([ran("", 1, REFUSED)]);
    const outcome = await stepsOver(cli, slept)["bb.tasks-done"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("refused its token") });
    expect(writes()).toBe(1);
    expect(slept).toEqual([]);
  });
});
