// Слой 2 — чисто. Чьи шаги отката (`undo`) должны пройти при доработке — до правок агента; исполняет server/automation-runner.ts.
import type { FlowProgress, WorkStage } from "../shared/contract";
import { undoStepsOf } from "./automation-run";
import { touched } from "./progress";

/**
 * Автоматизации с шагами отката, которые доработка — старт закрытого этапа `reopenedId` — сбрасывает: тронутые в `before`
 * этапы после него, закрытые или упавшие на середине, в обратном порядке — последняя откатывается первой. Этап не закрыт
 * или его нет во flow — доработки нет, и откатывать нечего.
 */
export const undoDue = (before: FlowProgress, stages: readonly WorkStage[], reopenedId: string): WorkStage[] => {
  const index = stages.findIndex((stage) => stage.id === reopenedId);
  if (index < 0 || before.stages[reopenedId]?.finishedAt === undefined) return [];
  return stages
    .slice(index + 1)
    .filter((stage) => touched(before.stages[stage.id]) && undoStepsOf(stage).length > 0)
    .reverse();
};
