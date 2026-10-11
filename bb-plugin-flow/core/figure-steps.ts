// Шаги «План → задача» и «Факт → задача» встают во flow сами: план — за переименованием треда по задаче, факт — перед
// «Задача → done». Только там, где у прогона есть задача, и только туда, где шага ещё нет.
import type { FlowSettings, WorkStage } from "../shared/contract";

type Steps = NonNullable<Extract<WorkStage["automation"], { source: "flow" }>>["steps"];

const withFigures = (steps: Steps): Steps => {
  const plan = steps.includes("bb.tasks-plan") ? steps : steps.flatMap((step) => (step === "bb.rename-thread" ? [step, "bb.tasks-plan" as const] : [step]));
  return plan.includes("bb.tasks-fact") ? plan : plan.flatMap((step) => (step === "bb.tasks-done" ? ["bb.tasks-fact" as const, step] : [step]));
};

/** Коллекция с шагами плана и факта; ставить некуда или уже стоят — та же коллекция. */
export const withFigureSteps = (settings: FlowSettings): FlowSettings => {
  let changed = false;
  const flows = settings.flows.map((flow) => ({
    ...flow,
    stages: flow.stages.map((stage) => {
      const automation = stage.automation;
      if (automation === undefined || !("source" in automation)) return stage;
      const steps = withFigures(automation.steps);
      if (steps.length === automation.steps.length) return stage;
      changed = true;
      return { ...stage, automation: { ...automation, steps } };
    }),
  }));
  return changed ? { ...settings, flows } : settings;
};
