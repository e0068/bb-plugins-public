// Этапы работ для тестов: настройки по умолчанию владельца и бриф со снимком
// этих настроек. Изменчивое живёт здесь, а не в теле тестов.
import type { Add, DecisionBrief, StageReport, WorkStage } from "../shared/contract";

export const add = (target: number, max: number, risk: number, minutes?: number): Add => ({ target, max, risk, ...(minutes === undefined ? {} : { minutes }) });

export const planner = { id: "agent:planner", kind: "agent", name: "planner", model: "opus", provider: "claude-code" } as const;
export const dev2 = { id: "workflow:DEV2", kind: "workflow", name: "DEV2" } as const;

export const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });

/** Flow Quick из двух этапов: встроенные Критерии и этап-навык implement. */
export const QUICK_STAGES: WorkStage[] = [{ id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] }, stage("implement", { skill: "code-standards-fp", name: "Implementation" })];

export const report = (id: string, patch: Partial<StageReport> = {}): StageReport => ({ id, state: "todo", recommended: false, executor: "self", ...patch });

export const STAGES: WorkStage[] = [
  stage("task", { skill: "task-flow", name: "Задача" }),
  stage("spec", { skill: "spec", name: "Спецификация" }),
  stage("plan", { skill: "plan", name: "План", executors: [planner, dev2] }),
];

export const stagedBrief = (reports: StageReport[], patch: Partial<DecisionBrief> = {}): DecisionBrief => ({
  id: "dec_stages",
  threadId: "thr_1",
  title: "Этапы",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "brief",
  stages: { list: STAGES, minButtonWidth: 170 },
  setup: { stages: reports },
  questions: [],
  ...patch,
});

type BuiltinSteps = Extract<NonNullable<WorkStage["automation"]>, { source: "flow" }>["steps"];

const automationOf = (id: string, name: string, steps: BuiltinSteps): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps } });

/** Этапы flow Code владельца, как в треде thr_897e6zxubm: 14 этапов, автоматизация двенадцатая. */
export const CODE_FLOW: WorkStage[] = [
  { id: "questions", kind: "questions", skill: "", name: "Questions", executors: [] },
  { id: "criteria", kind: "criteria", skill: "", name: "Criteria", executors: [] },
  { id: "select", kind: "select", skill: "", name: "Stage selection", executors: [] },
  stage("task", { skill: "task-flow", name: "Task" }),
  stage("prototype", { name: "HTML prototype" }),
  { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
  stage("spec", { name: "Spec" }),
  stage("plan", { name: "Plan" }),
  stage("implement", { skill: "code-standards-fp", name: "Implementation" }),
  stage("review", { skill: "code-review", name: "Review" }),
  stage("testing", { skill: "testing-tdd", name: "Testing" }),
  automationOf("flow-automation", "Commit, FF Branch ← Main, Открыть PR", ["git.commit", "git.fast-forward", "git.create-pr", "bb.tasks-in-review"]),
  { id: "demo-2", kind: "demo", skill: "", name: "Demonstration", executors: [] },
  automationOf("flow-automation-2", "Смёрджить PR, Задача → done, Pull Main ← Origin, Архивировать тред", ["git.commit", "git.merge", "bb.tasks-done", "git.pull-main", "bb.archive"]),
];

/** Полный flow, по которому написан пример брифа в навыке flow: этапы flow Code без автоматизаций. */
export const FULL_FLOW: WorkStage[] = CODE_FLOW.filter((s) => s.automation === undefined);
