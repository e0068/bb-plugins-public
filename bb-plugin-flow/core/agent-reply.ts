// Слой 1 — чисто. Нужна ли агенту реплика об ответе на бриф: работа впереди
// есть, или владелец приложил к ответу своё слово. Ответ, после которого
// агенту делать нечего, реплики не требует: хода не будет, а этапы и
// автоматизации за ним Flow ведёт сам.
import type { DecisionAnswer, DecisionBrief, FlowProgress } from "../shared/contract";
import { agentStagesAhead } from "./automation-run";

const said = (text: string | undefined): boolean => (text ?? "").trim().length > 0;

/**
 * Реплика нужна, пока в прогоне остаётся хоть один незакрытый этап агента, и
 * всегда — когда владелец написал своё или приложил картинку: это работа,
 * которую, кроме агента, никто не сделает. Уточнение агент ждёт посреди хода,
 * поэтому уходит всегда. Тред без снимка этапов или без записи прогресса о
 * работе впереди ничего не говорит — тогда реплика уходит, как раньше.
 * `progress` — запись треда уже с этим ответом.
 */
export const needsAgentReply = (brief: DecisionBrief, answer: DecisionAnswer, progress: FlowProgress | null, attachments = 0): boolean => {
  if (brief.kind !== "brief") return true;
  if (attachments > 0 || said(answer.note) || said(answer.outcome?.note)) return true;
  const stages = brief.stages?.list ?? [];
  if (progress === null || stages.length === 0) return true;
  return agentStagesAhead(stages, progress);
};
