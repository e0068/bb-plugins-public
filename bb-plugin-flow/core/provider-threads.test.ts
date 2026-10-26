// @vitest-environment node
// Тред другого провайдера исполнителем этапа: совет по лимитам и первое сообщение дочернему треду (BBPL-965).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { FlowProgress, WorkStage } from "../shared/contract";
import { EMPTY_PROGRESS } from "./progress";
import { ADVICE_PERCENT, delegatedReply, delegateMessage, earlierResults, limitsLine, reworkReply, sessionWindow, threadExecutor, threadProviderOf, type UsageSnapshot } from "./provider-threads";

const at = "2026-10-26T14:30:00.000Z";
const usage = (claude: number, codex: number): UsageSnapshot => ({
  "claude-code": { status: "ok", windows: [{ label: "Current session", usedPercent: claude, resetsAt: at }, { label: "Weekly", usedPercent: 10, resetsAt: null }] },
  codex: { status: "ok", windows: [{ label: "5-hour limit", usedPercent: codex, resetsAt: at }] },
});
const codex = threadExecutor({ id: "codex", displayName: "Codex" });
const opencode = threadExecutor({ id: "opencode", displayName: "opencode" });

describe("исполнитель «Тред провайдера»", () => {
  it("тред Codex — id thread:codex, вид thread, провайдер для иконки, группа bb", () => {
    expect(codex).toEqual({ id: "thread:codex", kind: "thread", name: "Тред Codex", provider: "codex", origin: { kind: "plugin", plugin: "bb" } });
  });

  it("провайдер берётся из id исполнителя-треда, у агента и workflow его нет", () => {
    expect(threadProviderOf("thread:codex")).toBe("codex");
    expect(threadProviderOf("agent:implementer")).toBeNull();
    expect(threadProviderOf("workflow:lead-waves")).toBeNull();
    expect(threadProviderOf("thread:")).toBeNull();
  });
});

describe("окно сессии провайдера", () => {
  it("окно по подписи сессии или пяти часов, а не первое по порядку", () => {
    expect(sessionWindow({ status: "ok", windows: [{ label: "Weekly", usedPercent: 50, resetsAt: null }, { label: "Current session", usedPercent: 7, resetsAt: at }] })?.usedPercent).toBe(7);
    expect(sessionWindow(usage(1, 33).codex)?.usedPercent).toBe(33);
  });

  it("без подписи — первое окно; без окон, без провайдера и не ok — окна нет", () => {
    expect(sessionWindow({ status: "ok", windows: [{ label: "Plan", usedPercent: 4, resetsAt: null }] })?.usedPercent).toBe(4);
    expect(sessionWindow({ status: "ok", windows: [] })).toBeNull();
    expect(sessionWindow(undefined)).toBeNull();
    expect(sessionWindow({ status: "unauthenticated" })).toBeNull();
  });
});

describe("строка лимитов во вкладе хода", () => {
  it("у flow нет треда провайдера — строки нет", () => {
    expect(limitsLine(usage(95, 5), [])).toBeNull();
  });

  it("Claude 80% и Codex 79% — совет отдать этапы thread:codex и назвать оба лимита во вступлении", () => {
    const line = limitsLine(usage(ADVICE_PERCENT, ADVICE_PERCENT - 1), [codex])!;
    expect(line).toContain("claude-code 80%, resets 2026-10-26T14:30:00.000Z");
    expect(line).toContain("codex (executor thread:codex) 79%");
    expect(line).toContain("recommend executor thread:codex");
    expect(line).toContain("intro");
  });

  it("Claude 79% — совета нет, лимиты видны", () => {
    const line = limitsLine(usage(ADVICE_PERCENT - 1, 0), [codex])!;
    expect(line).toContain("claude-code 79%");
    expect(line).not.toContain("recommend executor");
  });

  it("у Codex тоже 80% — совета на него нет", () => {
    expect(limitsLine(usage(99, ADVICE_PERCENT), [codex])).not.toContain("recommend executor");
  });

  it("провайдер без лимита у bb выбирается, но совета на него нет", () => {
    const line = limitsLine(usage(99, 99), [opencode])!;
    expect(line).toContain("opencode (executor thread:opencode) — bb reports no limit");
    expect(line).not.toContain("recommend executor");
  });

  it("сборка bb со старым ключом claudeCode читается так же", () => {
    const old: UsageSnapshot = { claudeCode: usage(90, 0)["claude-code"], codex: usage(0, 10).codex };
    expect(limitsLine(old, [codex])).toContain("recommend executor thread:codex");
  });

  it("совет есть ровно тогда, когда своё окно ≥ порога, а чужое ниже", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (own, other) => {
        const advised = limitsLine(usage(own, other), [codex])!.includes("recommend executor thread:codex");
        expect(advised).toBe(own >= ADVICE_PERCENT && other < ADVICE_PERCENT);
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
