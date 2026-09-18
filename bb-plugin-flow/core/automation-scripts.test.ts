import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { addScript, MAX_SCRIPT_CHARS, removeStep, scriptOf, scriptOutcome } from "./automation-scripts";
import { stepsOf } from "./automation-run";

type Builtin = Extract<NonNullable<WorkStage["automation"]>, { source: "flow" }>;

const empty: Builtin = { source: "flow", steps: [] };

describe("скрипт шагом встроенной автоматизации", () => {
  it("добавленный скрипт встаёт шагом в конец под данным id и хранит имя файла и содержимое", () => {
    const withPr: Builtin = { source: "flow", steps: ["git.create-pr"] };
    const next = addScript(withPr, { name: "deploy.sh", content: "echo ok" }, "1");
    expect(next.steps).toEqual(["git.create-pr", "script:1"]);
    expect(next.scripts).toEqual([{ id: "1", name: "deploy.sh", content: "echo ok" }]);
  });

  it("убранный шаг-скрипт уносит и сам скрипт, обычный шаг скрипты не трогает", () => {
    const both = addScript({ source: "flow", steps: ["git.commit"] }, { name: "a.sh", content: "1" }, "1");
    expect(removeStep(both, "script:1")).toEqual({ source: "flow", steps: ["git.commit"], scripts: [] });
    expect(removeStep(both, "git.commit")).toEqual({ source: "flow", steps: ["script:1"], scripts: both.scripts });
  });

  it("скрипт находится по id шага; обычный шаг и пропавший скрипт — null", () => {
    const one = addScript(empty, { name: "a.sh", content: "1" }, "1");
    expect(scriptOf(one, "script:1")).toEqual({ id: "1", name: "a.sh", content: "1" });
    expect(scriptOf(one, "script:9")).toBeNull();
    expect(scriptOf(one, "git.commit")).toBeNull();
  });

  it("в прогоне шаг-скрипт подписан именем файла", () => {
    const automation = addScript({ source: "flow", steps: ["git.commit"] }, { name: "notify.py", content: "print(1)" }, "1");
    const stage: WorkStage = { id: "a", kind: "skill", skill: "", name: "A", executors: [], automation };
    expect(stepsOf(stage)).toEqual([
      { id: "git.commit", label: "Commit" },
      { id: "script:1", label: "notify.py" },
    ]);
  });

  it("предел размера скрипта — 200 тысяч символов", () => {
    expect(MAX_SCRIPT_CHARS).toBe(200_000);
  });
});

describe("итог запуска скрипта", () => {
  it("код 0 — успех, подробность — последняя непустая строка вывода", () => {
    expect(scriptOutcome("a.sh", { code: 0, timedOut: false, output: "start\ndone: 3 files\n\n" })).toEqual({ ok: true, detail: "done: 3 files" });
  });

  it("код 0 без вывода — успех без подробности", () => {
    expect(scriptOutcome("a.sh", { code: 0, timedOut: false, output: "" })).toEqual({ ok: true, detail: null });
  });

  it("ненулевой код — провал с кодом и последними десятью строками вывода", () => {
    const output = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const outcome = scriptOutcome("a.sh", { code: 2, timedOut: false, output });
    expect(outcome.ok).toBe(false);
    const error = (outcome as { error: string }).error;
    expect(error.startsWith("The script a.sh exited with code 2:\n")).toBe(true);
    expect(error).toContain("line 6\n");
    expect(error).not.toContain("line 5\n");
    expect(error.endsWith("line 15")).toBe(true);
  });

  it("таймаут — провал со словами о времени", () => {
    expect(scriptOutcome("a.sh", { code: null, timedOut: true, output: "" })).toEqual({ ok: false, error: "The script a.sh did not finish in 10 minutes and was stopped." });
  });

  it("не запустился — провал с причиной", () => {
    expect(scriptOutcome("a.sh", { code: null, timedOut: false, output: "", spawnError: "EACCES" })).toEqual({ ok: false, error: "The script a.sh did not start: EACCES" });
  });
});
