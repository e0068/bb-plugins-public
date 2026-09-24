// Слой 2 — чисто. Порядок шагов внутри flow: что без открытого PR не работает.
//
// Шаги бампа версии и мёрджа работают по номеру открытого PR. Цепочка, где они
// стоят раньше шага «Открыть PR», падает на первом же прогоне любого треда —
// ровно так и падало у владельца. Правило смотрит на весь flow, а не на одну
// цепочку: в рабочем flow PR открывает первая цепочка, а мёрджит вторая, и это
// законно.
//
// Автоматизация плагина Automations — чёрный ящик: её шаги здесь не видны, и
// PR она открыть может. Встретив такую, правило замолкает до конца flow:
// запрет, который не может отличить рабочий flow от сломанного, дороже пробела.
import { isStepId, type StepId } from "../packages/automation-steps/catalog";
import type { Flow, WorkStage } from "../shared/contract";

/** Шаги, которым нужен уже открытый PR. */
export const NEEDS_OPEN_PR: readonly StepId[] = ["files.bump-major", "files.bump-minor", "files.bump-patch", "git.merge"];

const OPENS_PR: StepId = "git.create-pr";

const needsOpenPr = (step: string): step is StepId => isStepId(step) && NEEDS_OPEN_PR.includes(step);

/** Встроенная автоматизация Flow: её шаги видны. Автоматизация Automations — нет. */
const builtinSteps = (stage: WorkStage): readonly string[] | null => {
  const automation = stage.automation;
  if (automation === undefined) return [];
  return "source" in automation ? automation.steps : null;
};

/** Открывается ли PR раньше этапа `stageId` — по этапам до него и шагам самого этапа. */
export const opensPrBefore = (stages: readonly WorkStage[], stageId: string): boolean => {
  for (const stage of stages) {
    const steps = builtinSteps(stage);
    if (steps === null) return true;
    if (steps.includes(OPENS_PR)) return true;
    if (stage.id === stageId) return false;
  }
  return false;
};

export type StepOrderProblem = { flowId: string; flowName: string; stageId: string; stageName: string; step: StepId };

/** Первый шаг flow, которому нужен открытый PR, а его ещё никто не открыл; `null` — порядок рабочий. */
export const flowStepOrderProblem = (flow: Flow): StepOrderProblem | null => {
  let opened = false;
  for (const stage of flow.stages) {
    const steps = builtinSteps(stage);
    if (steps === null) return null;
    for (const step of steps) {
      if (step === OPENS_PR) opened = true;
      else if (!opened && needsOpenPr(step)) {
        return { flowId: flow.id, flowName: flow.name, stageId: stage.id, stageName: stage.name, step };
      }
    }
  }
  return null;
};

/** То же по всей коллекции: первый сломанный порядок в первом сломанном flow. */
export const stepOrderProblem = (flows: readonly Flow[]): StepOrderProblem | null =>
  flows.reduce<StepOrderProblem | null>((found, flow) => found ?? flowStepOrderProblem(flow), null);

/** Текст отказа: владелец должен прочесть, что именно переставить, не открывая ничего. */
export const stepOrderMessage = (problem: StepOrderProblem, stepLabel: string, openLabel: string): string =>
  `"${stepLabel}" in "${problem.stageName}" of the flow "${problem.flowName}" stands before "${openLabel}": it works on an open pull request, and without one the chain stops on the first run. Move it after the stage that opens the pull request.`;
