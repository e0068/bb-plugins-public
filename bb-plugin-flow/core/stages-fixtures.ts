// Этапы работ для тестов: настройки по умолчанию владельца и бриф со снимком
// этих настроек. Изменчивое живёт здесь, а не в теле тестов.
import type { Add, DecisionBrief, StageReport, WorkStage } from "../shared/contract";

export const add = (target: number, max: number, risk: number, minutes?: number): Add => ({ target, max, risk, ...(minutes === undefined ? {} : { minutes }) });

export const planner = { id: "agent:planner", kind: "agent", name: "planner", model: "opus", provider: "claude-code" } as const;
export const dev2 = { id: "workflow:DEV2", kind: "workflow", name: "DEV2" } as const;

export const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });

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
