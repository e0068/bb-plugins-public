// Слой 1 — чисто. Нужна ли агенту реплика об ответе на бриф: работа впереди
// есть, или владелец приложил к ответу своё слово. Ответ, после которого
// агенту делать нечего, реплики не требует: хода не будет, а этапы и
// автоматизации за ним Flow ведёт сам.
import type { DecisionAnswer, DecisionBrief, FlowProgress } from "../shared/contract";
import { agentStagesAhead } from "./automation-run";
import { ownWords } from "./outcome";

const said = (text: string | undefined): boolean => (text ?? "").trim().length > 0;

/**
 * Остаётся ли в прогоне работа агента: после этапа итога брифа, а у брифа без итога — во всём flow. Тред без снимка этапов
 * или без записи прогресса о работе впереди ничего не говорит — работа считается.
 */
const workAhead = (brief: DecisionBrief, progress: FlowProgress | null): boolean => {
  const stages = brief.stages?.list ?? [];
  return progress === null || stages.length === 0 || agentStagesAhead(stages, progress, brief.outcome?.stage);
};

/**
 * Утверждение, после которого агенту делать нечего: за его этапом в прогоне только автоматизации и Action. Ответ без
 * своих слов владельца агента не разбудит, поэтому и сжимать тред перед ним незачем. Признак снимается при загрузке
 * утверждения: этап агента, вернувшийся в прогон, пока оно открыто, его не включит — это лишь не предложит сжатие.
 */
export const idleAfter = (brief: DecisionBrief, progress: FlowProgress | null): boolean =>
  brief.kind === "brief" && brief.outcome !== undefined && !workAhead(brief, progress);

/**
 * Реплика нужна, пока в прогоне остаётся хоть один незакрытый этап агента, и
 * всегда — когда владелец написал своё, в том числе в строке вопроса, или приложил картинку: это работа,
 * которую, кроме агента, никто не сделает. Уточнение агент ждёт посреди хода,
 * поэтому уходит всегда. `progress` — запись треда уже с этим ответом.
 */
export const needsAgentReply = (brief: DecisionBrief, answer: DecisionAnswer, progress: FlowProgress | null, attachments = 0): boolean =>
  brief.kind !== "brief" || attachments > 0 || said(answer.note) || said(answer.outcome?.note) || ownWords(answer) || workAhead(brief, progress);
