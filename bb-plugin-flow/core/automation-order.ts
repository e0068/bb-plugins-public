// Слой 2 — чисто. Порядок шагов внутри flow: какому шагу нужен открытый PR, а выше его никто не открывает.
//
// Шаги бампа версии и мёрджа работают по номеру открытого PR. Но PR принадлежит
// ветке треда, а не flow: шаг находит его у GitHub на запуске, и PR мог открыть
// другой flow, прошлый прогон или владелец вручную. Поэтому порядок не запрет, а
// подсказка: редактор помечает шаг, который по составу самого flow остался без
// «Открыть PR» выше, и сохраняет любой порядок.
//
// Автоматизация плагина Automations — чёрный ящик: её шаги здесь не видны, и
// PR она открыть может. Встретив такую выше, правило молчит: метка, которая не
// может отличить рабочий flow от сломанного, дороже пробела.
import { isStepId, type StepId } from "@bb-plugins/automation-steps/catalog";
import type { WorkStage } from "../shared/contract";

/** Шаги, которым нужен уже открытый PR. */
const NEEDS_OPEN_PR: readonly StepId[] = ["files.bump-major", "files.bump-minor", "files.bump-patch", "git.merge"];

const OPENS_PR: StepId = "git.create-pr";

const needsOpenPr = (step: string): step is StepId => isStepId(step) && NEEDS_OPEN_PR.includes(step);

/** Встроенная автоматизация Flow: её шаги видны. Автоматизация Automations — нет. */
const builtinSteps = (stage: WorkStage): readonly string[] | null => {
  const automation = stage.automation;
  if (automation === undefined) return [];
  return "source" in automation ? automation.steps : null;
};

/**
 * Шаги этапа `stageId`, которым нужен открытый PR, а по этапам `stages` его до них никто не открывает: ни этапы выше, ни
 * шаги самого этапа левее. Выше стоит автоматизация Automations — шагов не видно, и помечать нечего.
 */
export const unopenedPrSteps = (stages: readonly WorkStage[], stageId: string): readonly StepId[] => {
  const at = stages.findIndex((s) => s.id === stageId);
  const own = at < 0 ? null : builtinSteps(stages[at]!);
  const above = stages.slice(0, Math.max(at, 0)).map(builtinSteps);
  if (own === null || above.some((steps) => steps === null || steps.includes(OPENS_PR))) return [];
  const opening = own.indexOf(OPENS_PR);
  return own.slice(0, opening < 0 ? own.length : opening).filter(needsOpenPr);
};
