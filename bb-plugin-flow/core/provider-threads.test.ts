// @vitest-environment node
// Тред другого провайдера исполнителем этапа: совет по темпу лимитов и первое сообщение дочернему треду (BBPL-965).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS } from "./progress";
import { DEFAULT_PACE_LEAD, paceLeadOf, delegatedReply, delegateMessage, earlierResults, judgedWindows, limitsLine, overtakes, paceOf, reworkReply, threadExecutor, threadProviderOf, type ProviderUsage, type UsageSnapshot } from "./provider-threads";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-26T12:00:00.000Z");
/** Окно длиной `hours` часов, из которого прошло `elapsedPercent` процентов: сброс — через остаток. */
const resetAt = (hours: number, elapsedPercent: number): string => new Date(NOW + ((100 - elapsedPercent) * hours * HOUR) / 100).toISOString();
const session = (used: number, elapsed: number) => ({ label: "Current session", usedPercent: used, resetsAt: resetAt(5, elapsed) });
const week = (used: number, elapsed: number) => ({ label: "Weekly limit", usedPercent: used, resetsAt: resetAt(168, elapsed) });
const ok = (...windows: ProviderUsage["windows"] & object): ProviderUsage => ({ status: "ok", windows });
const snapshot = (claude: ProviderUsage, codex: ProviderUsage): UsageSnapshot => ({ "claude-code": claude, codex });
const options = { now: NOW, lead: DEFAULT_PACE_LEAD };
const line = (claude: ProviderUsage, codex: ProviderUsage, ...executors: ReturnType<typeof threadExecutor>[]) => limitsLine(snapshot(claude, codex), executors.length === 0 ? [codexExecutor] : executors, options)!;
const codexExecutor = threadExecutor({ id: "codex", displayName: "Codex" });
const opencode = threadExecutor({ id: "opencode", displayName: "opencode" });

describe("исполнитель «Тред провайдера»", () => {
  it("тред Codex — id thread:codex, вид thread, провайдер для иконки, группа bb", () => {
    expect(codexExecutor).toEqual({ id: "thread:codex", kind: "thread", name: "Тред Codex", provider: "codex", origin: { kind: "plugin", plugin: "bb" } });
  });

  it("провайдер берётся из id исполнителя-треда, у агента и workflow его нет", () => {
    expect(threadProviderOf("thread:codex")).toBe("codex");
    expect(threadProviderOf("agent:implementer")).toBeNull();
    expect(threadProviderOf("workflow:lead-waves")).toBeNull();
    expect(threadProviderOf("thread:")).toBeNull();
  });
});

describe("окна, о темпе которых судят", () => {
  it("пятичасовое — по подписи сессии или пяти часов, недельное — по подписи недели; окно одной модели и неясные подписи не судятся", () => {
    const windows = judgedWindows(ok(session(1, 50), { label: "5-hour limit", usedPercent: 2, resetsAt: null }, week(3, 50), { label: "Weekly", usedPercent: 4, resetsAt: null }, { label: "Current week (all models)", usedPercent: 5, resetsAt: null }, { label: "Current week (Fable)", usedPercent: 6, resetsAt: null }, { label: "Monthly limit", usedPercent: 7, resetsAt: null }));
    expect(windows.map((w) => [w.kind, w.window.usedPercent])).toEqual([["5-hour", 1], ["5-hour", 2], ["weekly", 3], ["weekly", 4], ["weekly", 5]]);
    expect(windows.map((w) => w.durationMs)).toEqual([5 * HOUR, 5 * HOUR, 168 * HOUR, 168 * HOUR, 168 * HOUR]);
  });

  it("провайдер без данных, не ok и без окон — окон нет", () => {
    expect(judgedWindows(undefined)).toEqual([]);
    expect(judgedWindows({ status: "unauthenticated" })).toEqual([]);
    expect(judgedWindows(ok())).toEqual([]);
  });
});

describe("темп окна", () => {
  it("прошедшее время — из сброса и длины окна, в пределах окна", () => {
    expect(paceOf(session(30, 50), 5 * HOUR, NOW)).toEqual({ usedPercent: 30, elapsedMs: 2.5 * HOUR, durationMs: 5 * HOUR });
    expect(paceOf({ label: "x", usedPercent: 1, resetsAt: new Date(NOW - HOUR).toISOString() }, 5 * HOUR, NOW)?.elapsedMs).toBe(5 * HOUR);
    expect(paceOf({ label: "x", usedPercent: 1, resetsAt: new Date(NOW + 9 * HOUR).toISOString() }, 5 * HOUR, NOW)?.elapsedMs).toBe(0);
  });

  it("сброса нет или он не разобрался — темпа нет", () => {
    expect(paceOf({ label: "x", usedPercent: 1, resetsAt: null }, 5 * HOUR, NOW)).toBeNull();
    expect(paceOf({ label: "x", usedPercent: 1, resetsAt: "скоро" }, 5 * HOUR, NOW)).toBeNull();
  });

  it("обгон — на пороге и выше; ниже порога нет; в первые 10% окна темп не судится", () => {
    const pace = (used: number, elapsed: number) => ({ usedPercent: used, elapsedMs: (elapsed * 5 * HOUR) / 100, durationMs: 5 * HOUR });
    expect(overtakes(pace(60, 50), 20)).toBe(true);
    expect(overtakes(pace(59, 50), 20)).toBe(false);
    expect(overtakes(pace(12, 10), 20)).toBe(true);
    expect(overtakes(pace(90, 9), 20)).toBe(false);
    expect(overtakes(pace(0, 100), 20)).toBe(false);
  });
});

describe("порог обгона из настроек", () => {
  it("целое число от 1 до 500 — порог; всё прочее — умолчание", () => {
    expect(paceLeadOf(35)).toBe(35);
    expect(paceLeadOf(1)).toBe(1);
    expect(paceLeadOf(500)).toBe(500);
    for (const bad of [0, -5, 501, 12.5, Number.NaN, "20", null, undefined]) expect(paceLeadOf(bad)).toBe(DEFAULT_PACE_LEAD);
  });
});

describe("строка лимитов во вкладе хода", () => {
  it("у flow нет треда провайдера — строки нет", () => {
    expect(limitsLine(snapshot(ok(session(95, 10)), ok(session(5, 50))), [], options)).toBeNull();
  });

  it("Claude обгоняет время, а Codex нет — совет отдать этапы thread:codex; названы окно, темп и сброс обоих", () => {
    const text = line(ok(session(80, 50)), ok(session(7, 50)));
    expect(text).toContain("claude-code");
    expect(text).toContain("5-hour 80% used, 50% of the time passed");
    expect(text).toContain(`resets ${resetAt(5, 50)}`);
    expect(text).toContain("codex (executor thread:codex)");
    expect(text).toContain("recommend executor thread:codex");
    expect(text).toContain("5-hour window");
    expect(text).toContain("intro");
  });

  it("окно почти выбрано, но времени до сброса почти столько же — совета нет: так и задумано", () => {
    expect(line(ok(session(95, 94)), ok(session(7, 50)))).not.toContain("recommend executor");
  });

  it("окно выбрано наполовину в первые 10% — темп не судится, совета нет", () => {
    const text = line(ok(session(40, 8)), ok(session(7, 50)));
    expect(text).toContain("too early to judge the pace");
    expect(text).not.toContain("recommend executor");
  });

  it("обгоняет только недельное окно — совет называет его", () => {
    const text = line(ok(session(10, 50), week(70, 40)), ok(session(7, 50), week(5, 40)));
    expect(text).toContain("recommend executor thread:codex");
    expect(text).toContain("weekly window");
    expect(text).not.toContain("5-hour window burns");
  });

  it("у Codex темп тоже обгоняет — совета на него нет", () => {
    expect(line(ok(session(80, 50)), ok(session(80, 50)))).not.toContain("recommend executor");
    expect(line(ok(session(80, 50)), ok(session(7, 50), week(90, 40)))).not.toContain("recommend executor");
  });

  it("провайдер без лимита у bb выбирается, но совета на него нет", () => {
    const text = limitsLine({ "claude-code": ok(session(99, 50)) }, [opencode], options)!;
    expect(text).toContain("opencode (executor thread:opencode) — bb reports no limit");
    expect(text).not.toContain("recommend executor");
  });

  it("у Claude нет данных — совета нет, лимиты чужих видны", () => {
    const text = limitsLine({ codex: ok(session(7, 50)) }, [codexExecutor], options)!;
    expect(text).toContain("claude-code — bb reports no limit");
    expect(text).not.toContain("recommend executor");
  });

  it("сброс окна неизвестен — окно называется без темпа и не обгоняет", () => {
    const text = line(ok({ label: "Current session", usedPercent: 99, resetsAt: null }), ok(session(7, 50)));
    expect(text).toContain("reset time unknown");
    expect(text).not.toContain("recommend executor");
  });

  it("сборка bb со старым ключом claudeCode читается так же", () => {
    const old: UsageSnapshot = { claudeCode: ok(session(80, 50)), codex: ok(session(7, 50)) };
    expect(limitsLine(old, [codexExecutor], options)).toContain("recommend executor thread:codex");
  });

  it("порог берётся из настройки: при 50% обгон в 1,5 раза", () => {
    const strict = limitsLine(snapshot(ok(session(70, 50)), ok(session(7, 50))), [codexExecutor], { now: NOW, lead: 50 })!;
    expect(strict).not.toContain("recommend executor");
    expect(limitsLine(snapshot(ok(session(75, 50)), ok(session(7, 50))), [codexExecutor], { now: NOW, lead: 50 })).toContain("recommend executor");
  });

  it("обгоняющее окно помечено в строке", () => {
    expect(line(ok(session(80, 50)), ok(session(7, 50)))).toContain("5-hour 80% used, 50% of the time passed — burning ahead of its time");
  });

  it("у Codex окно выбрано целиком, хоть и не обгоняет время, — совета на него нет", () => {
    expect(line(ok(session(80, 50)), ok(session(100, 90)))).not.toContain("recommend executor");
    expect(line(ok(session(80, 50)), ok(session(7, 50), week(100, 85)))).not.toContain("recommend executor");
  });

  it("у Codex сброс окна неизвестен — о его темпе не судят, совета на него нет", () => {
    expect(line(ok(session(80, 50)), ok({ label: "Current session", usedPercent: 95, resetsAt: null }))).not.toContain("recommend executor");
  });

  it("совет есть ровно тогда, когда своё окно обгоняет, а окно исполнителя не обгоняет и не выбрано целиком", () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 200 }), (elapsed, own, other, lead) => {
        const text = limitsLine(snapshot(ok(session(own, elapsed)), ok(session(other, elapsed))), [codexExecutor], { now: NOW, lead })!;
        const ahead = (used: number) => used * 100 >= elapsed * (100 + lead);
        expect(text.includes("recommend executor thread:codex")).toBe(ahead(own) && !ahead(other) && other < 100);
      }),
    );
  });
});

describe("первое сообщение дочернему треду", () => {
  const message = delegateMessage({
    stage: { name: "Execution", skill: "code-standards-fp" },
    skillPath: "/Users/me/.claude/skills/code-standards-fp/SKILL.md",
    criteria: ["Тред Codex выбирается исполнителем"],
    results: [{ label: "BBPL-965", target: "BBPL-965" }, { label: "spec.md", target: "docs/specs/spec.md" }],
  });

  it("называет этап, файл навыка, Definition of Done и результаты прошлых этапов", () => {
    expect(message).toContain('"Execution"');
    expect(message).toContain("/Users/me/.claude/skills/code-standards-fp/SKILL.md");
    expect(message).toContain("- Тред Codex выбирается исполнителем");
    expect(message).toContain("- spec.md — docs/specs/spec.md");
  });

  it("велит закоммитить в ветке без push и PR и закончить ход отчётом", () => {
    expect(message).toContain("Commit");
    expect(message).toContain("Do not push");
    expect(message).toContain("report");
  });

  it("навык без файла — только имя; без Definition of Done и результатов — без пустых разделов", () => {
    const bare = delegateMessage({ stage: { name: "Execution", skill: "code-standards-fp" }, skillPath: null, criteria: [], results: [] });
    expect(bare).toContain("code-standards-fp");
    expect(bare).not.toContain("Definition of Done:");
    expect(bare).not.toContain("Results of the stages before it:");
  });
});

describe("отметка этапа, отданного дочернему треду", () => {
  const stage = (id: string): WorkStage => ({ id, name: id, kind: "skill", skill: "", executors: [] });
  const stages = [stage("task"), stage("spec"), stage("plan"), stage("practice"), stage("review")];
  const progress: FlowProgress = {
    ...EMPTY_PROGRESS,
    stages: {
      task: { finishedAt: "t1", results: [{ label: "BBPL-965", target: "BBPL-965" }] },
      spec: { finishedAt: "t2", results: [{ label: "spec.md", target: "docs/specs/spec.md", title: "Спека" }] },
      plan: { startedAt: "t3", results: [{ label: "plan.md", target: "docs/plans/plan.md" }] },
      review: { finishedAt: "t0", results: [{ label: "старый вердикт", target: "x" }] },
    },
  };

  it("ребёнок получает результаты закрытых этапов до своего, по порядку flow", () => {
    expect(earlierResults(stages, progress, "practice")).toEqual([
      { label: "BBPL-965", target: "BBPL-965" },
      { label: "spec.md", target: "docs/specs/spec.md" },
    ]);
    expect(earlierResults(stages, progress, "unknown")).toEqual([]);
  });

  it("тред завёлся — ответ велит закончить ход и ждать отчёта; не завёлся — делать этап самому", () => {
    const created = delegatedReply("practice", "codex", { kind: "created", threadId: "thr_codex" });
    expect(created).toContain("@thread:thr_codex on codex");
    expect(created).toContain("end your turn now");
    expect(created).toContain("mark stage practice done");
    const failed = delegatedReply("practice", "codex", { kind: "failed", error: "not installed" });
    expect(failed).toContain("(not installed)");
    expect(failed).toContain("do the stage yourself");
  });
});

describe("доработка этапа, уже отданного дочернему треду", () => {
  it("ответ велит передать правки прежнему ребёнку, а не ждать нового", () => {
    const reply = reworkReply("practice", "codex");
    expect(reply).toContain("does not start a second one");
    expect(reply).toContain("bb thread tell");
    expect(reply).toContain("mark stage practice done");
  });
});
