// @vitest-environment node
// Скрипт выбора flow: вход из stdin и модель из окружения доходят до CLI поставщика, служебный вывод CLI в ответ не попадает.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runScript } from "../server/script-step";

const script = { name: "choose-flow.sh", content: readFileSync(new URL("./choose-flow.sh", import.meta.url), "utf8") };

/** Папка с подменённым CLI: он пишет аргументы и stdin в файлы рядом, в stderr — шум, в stdout — ответ. */
const fakeCli = (name: string, answer: string, code = 0) => {
  const dir = mkdtempSync(join(tmpdir(), "flow-cli-"));
  writeFileSync(join(dir, name), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\ncat > "${dir}/stdin"\necho noise >&2\necho "${answer}"\nexit ${code}\n`, { mode: 0o755 });
  return dir;
};

const run = (dir: string, env: Record<string, string>) =>
  runScript(script, { cwd: tmpdir(), threadId: "", environmentId: "" }, { input: "RULES\n\nПочини кнопку", env: { PATH: `${dir}:/usr/bin:/bin`, ...env } });

describe("скрипт выбора flow", () => {
  it("Claude Code: один вызов -p с моделью, вход из stdin, ответ — последняя строка", async () => {
    const dir = fakeCli("claude", "quick");
    expect(await run(dir, { FLOW_PROVIDER: "claude-code", FLOW_MODEL: "sonnet", FLOW_EFFORT: "low" })).toEqual({ ok: true, detail: "quick" });
    expect(readFileSync(join(dir, "args"), "utf8").split("\n")).toEqual(expect.arrayContaining(["-p", "--model", "sonnet", "--no-session-persistence", "--effort", "low"]));
    expect(readFileSync(join(dir, "stdin"), "utf8")).toBe("RULES\n\nПочини кнопку");
  });

  it("Claude Code: уровень effort, которого claude не знает, — без флага", async () => {
    const dir = fakeCli("claude", "quick");
    await run(dir, { FLOW_PROVIDER: "claude-code", FLOW_MODEL: "sonnet", FLOW_EFFORT: "ultra" });
    expect(readFileSync(join(dir, "args"), "utf8")).not.toContain("--effort");
  });

  it("Codex: exec с моделью и effort, вход из stdin", async () => {
    const dir = fakeCli("codex", "none");
    expect(await run(dir, { FLOW_PROVIDER: "codex", FLOW_MODEL: "gpt-5", FLOW_EFFORT: "high" })).toEqual({ ok: true, detail: "none" });
    expect(readFileSync(join(dir, "args"), "utf8").split("\n")).toEqual(expect.arrayContaining(["exec", "-m", "gpt-5", "model_reasoning_effort=high", "-"]));
  });

  it("упавший CLI — провал с его stderr", async () => {
    const outcome = await run(fakeCli("claude", "", 1), { FLOW_PROVIDER: "claude-code", FLOW_MODEL: "sonnet", FLOW_EFFORT: "low" });
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? "" : outcome.error).toContain("noise");
  });

  it("поставщик без вызова без треда — провал с кодом 2", async () => {
    const outcome = await run(fakeCli("claude", "quick"), { FLOW_PROVIDER: "kimi", FLOW_MODEL: "k2", FLOW_EFFORT: "low" });
    expect(outcome.ok ? "" : outcome.error).toMatch(/exited with code 2:\nThe provider kimi has no one-shot call\./);
  });
});
