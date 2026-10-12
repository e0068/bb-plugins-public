// Снимок формы длинного flow для тестов инструкций: семнадцать этапов с длинными id, под-этапами, исполнителями,
// автоматизациями и утверждениями — те же виды и длины, что у настоящего, но без его содержимого: данные
// владельца тестам не образец.
import type { WorkStage } from "../shared/contract";

const agent = (name: string) => ({ id: `agent:${name}`, kind: "agent" as const, name });
const workflow = (name: string) => ({ id: `workflow:${name}`, kind: "workflow" as const, name });
const automation = (id: string, name: string, patch: Partial<WorkStage> = {}): WorkStage => ({ executors: [], id, kind: "skill", skill: "", name, automation: { source: "flow", steps: ["bb.archive"] }, ...patch });
const skill = (id: string, name: string, skillName: string, patch: Partial<WorkStage> = {}): WorkStage => ({ executors: [], id, kind: "skill", skill: skillName, name, ...patch });
const builtin = (id: string, kind: "questions" | "criteria" | "select" | "demo" | "approve", name: string, patch: Partial<WorkStage> = {}): WorkStage => ({ executors: [], id, kind, skill: "", name, ...patch });

export const LONG_FLOW: WorkStage[] = [
  skill("stage-aaaaaaaaaaaa", "BB Plugin", "bb-plugin-authoring"),
  builtin("nested-flow.questions", "questions", "Questions"),
  builtin("nested-flow.stage-bbbbbbbbbbbb", "criteria", "Definition of Done"),
  builtin("nested-flow.select", "select", "Stage selection"),
  builtin("nested-flow.approve", "approve", "Approval"),
  skill("nested-flow.stage-cccccccccccc", "task-flow", "task-flow"),
  automation("nested-flow.stage-dddddddddddd", "Переименовать тред"),
  skill("stage-eeeeeeeeeeee", "Prototype", "prototype"),
  builtin("stage-ffffffffffff", "demo", "Demonstration", { parent: "stage-eeeeeeeeeeee" }),
  builtin("stage-gggggggggggg", "approve", "Approval"),
  skill("spec", "Spec", "spec"),
  skill("plan", "Plan", "plan", { executors: [agent("lead-planner")] }),
  skill("practice", "Execution", "code-standards-fp", { executors: [agent("implementer"), workflow("lead-waves")] }),
  skill("code-review", "code-review", "code-review", { executors: [agent("code-reviewer")] }),
  automation("flow-automation", "Commit, FF to Main, PR"),
  automation("stage-hhhhhhhhhhhh", "Plugin Preview", { parent: "demo" }),
  builtin("demo", "demo", "Demonstration"),
  builtin("stage-iiiiiiiiiiii", "approve", "Approval"),
  automation("flow-automation-2", "Finalize"),
];
