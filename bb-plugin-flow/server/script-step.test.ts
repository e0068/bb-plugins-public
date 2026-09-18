// @vitest-environment node
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runScript, scriptStep } from "./script-step";

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "flow-cwd-")));

describe("запуск скрипта", () => {
  it("скрипт без shebang идёт через sh в рабочем дереве и видит id треда", async () => {
    const cwd = dir();
    const outcome = await runScript({ name: "a.sh", content: 'pwd > out.txt\necho "$BB_THREAD_ID" >> out.txt\necho finished' }, { cwd, threadId: "thr_1", environmentId: "env_1" });
    expect(outcome).toEqual({ ok: true, detail: "finished" });
    expect(readFileSync(join(cwd, "out.txt"), "utf8")).toBe(`${cwd}\nthr_1\n`);
  });

  it("скрипт с shebang запускается своим интерпретатором", async () => {
    const outcome = await runScript({ name: "a.js", content: "#!/usr/bin/env node\nconsole.log(typeof process.version)" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    expect(outcome).toEqual({ ok: true, detail: "string" });
  });

  it("ненулевой код — провал с выводом stderr", async () => {
    const outcome = await runScript({ name: "fail.sh", content: "echo broken >&2\nexit 3" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    expect(outcome).toEqual({ ok: false, error: "The script fail.sh exited with code 3:\nbroken" });
  });

  it("шаг треда без рабочего дерева — провал без запуска", async () => {
    const sdk = {
      threads: { get: async () => ({ environmentId: "e1" }) },
      environments: { get: async () => ({ id: "e1", path: null }) },
    };
    const step = scriptStep(sdk as never);
    expect(await step("t1", { id: "1", name: "a.sh", content: "exit 0" })).toEqual({ ok: false, error: "The thread has no working copy on disk to run the script in." });
  });

  it("шаг треда с деревом запускает скрипт в нём", async () => {
    const cwd = dir();
    const sdk = {
      threads: { get: async () => ({ environmentId: "e1" }) },
      environments: { get: async () => ({ id: "e1", path: cwd }) },
    };
    expect(await scriptStep(sdk as never)("t1", { id: "1", name: "a.sh", content: "echo $BB_ENVIRONMENT_ID" })).toEqual({ ok: true, detail: "e1" });
  });
});

describe("запуск скрипта — края", () => {
  const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("flow-script-")).sort();

  it("временный файл скрипта удаляется и после успеха, и после провала", async () => {
    const before = leftovers();
    await runScript({ name: "ok.sh", content: "exit 0" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    await runScript({ name: "bad.sh", content: "exit 1" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    expect(leftovers().filter((name) => !before.includes(name))).toEqual([]);
  });

  it("таймаут останавливает скрипт вместе с фоновыми процессами и не ждёт их", async () => {
    const cwd = dir();
    const started = Date.now();
    const outcome = await runScript({ name: "slow.sh", content: "(sleep 5; touch late.txt) &\nsleep 5" }, { cwd, threadId: "t", environmentId: "e" }, { timeoutMs: 300 });
    expect(outcome).toEqual({ ok: false, error: "The script slow.sh did not finish in 10 minutes and was stopped." });
    expect(Date.now() - started).toBeLessThan(3000);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    expect(existsSync(join(cwd, "late.txt"))).toBe(false);
  }, 15_000);

  it("скрипт, оставивший фоновый процесс, завершает шаг сразу по своему выходу", async () => {
    const started = Date.now();
    const outcome = await runScript({ name: "bg.sh", content: "sleep 5 &\necho launched" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    expect(outcome).toEqual({ ok: true, detail: "launched" });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("shebang на несуществующий интерпретатор — провал запуска", async () => {
    const outcome = await runScript({ name: "a.x", content: "#!/nonexistent/interpreter\nexit 0" }, { cwd: dir(), threadId: "t", environmentId: "e" });
    expect(outcome.ok).toBe(false);
  });

  it("имя файла с путём или «..» не влияет на место временного файла", async () => {
    for (const name of ["../escape.sh", "a/b.sh", ".."]) {
      expect(await runScript({ name, content: "echo ran" }, { cwd: dir(), threadId: "t", environmentId: "e" })).toEqual({ ok: true, detail: "ran" });
    }
  });
});
