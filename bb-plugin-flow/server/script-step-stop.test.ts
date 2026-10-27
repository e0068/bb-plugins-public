// @vitest-environment node
// BBPL-969: «Стоп» обрывает шаг-скрипт сразу — вместе со всем, что скрипт запустил в фоне.
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { STOPPED_ERROR } from "../core/automation-run";
import { runScript, scriptStep } from "./script-step";

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "flow-stop-")));
const place = (cwd: string) => ({ cwd, threadId: "t", environmentId: "e" });

describe("скрипт обрывается по сигналу", () => {
  it("долгий скрипт гаснет за доли секунды, итог — остановка владельцем", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const outcome = runScript({ name: "slow.sh", content: "sleep 30" }, place(dir()), { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    expect(await outcome).toEqual({ ok: false, error: STOPPED_ERROR });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("фоновый потомок скрипта гаснет вместе с ним", async () => {
    const cwd = dir();
    const controller = new AbortController();
    const outcome = runScript({ name: "bg.sh", content: "(sleep 1; touch late.txt) &\nsleep 30" }, place(cwd), { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await outcome;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(existsSync(join(cwd, "late.txt"))).toBe(false);
  });

  it("уже снятый сигнал скрипт не запускает", async () => {
    const cwd = dir();
    const controller = new AbortController();
    controller.abort();
    expect(await runScript({ name: "a.sh", content: "touch ran.txt" }, place(cwd), { signal: controller.signal })).toEqual({ ok: false, error: STOPPED_ERROR });
    expect(existsSync(join(cwd, "ran.txt"))).toBe(false);
  });

  it("сигнал, не снятый до конца, итог не меняет", async () => {
    expect(await runScript({ name: "a.sh", content: "echo done" }, place(dir()), { signal: new AbortController().signal })).toEqual({ ok: true, detail: "done" });
  });

  it("шаг треда передаёт сигнал скрипту", async () => {
    const cwd = dir();
    const sdk = { threads: { get: async () => ({ environmentId: "e1" }) }, environments: { get: async () => ({ id: "e1", path: cwd }) } };
    const controller = new AbortController();
    const outcome = scriptStep(sdk as never)("t1", { id: "1", name: "slow.sh", content: "sleep 30" }, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await outcome).toEqual({ ok: false, error: STOPPED_ERROR });
  });
});
