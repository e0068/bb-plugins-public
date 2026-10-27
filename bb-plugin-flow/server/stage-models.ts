// Что Flow делает с тредом перед работой агента над этапом: сжать (контекст не обычный) и поставить утверждённую модель этапа.
// Один помощник на оба пути к этапу — отметку flow_stage и ответ владельца на бриф, — чтобы правило не жило дважды.
// Модель этапа не вычисляется здесь: её утвердил бриф, она лежит в следе прогона (BBPL-968).
import { boundaryPlan, contextTone, type BoundaryPlan, type StageModel } from "../core/context";
import type { ContextFillView, FlowProgress, WorkStage } from "../shared/contract";

export interface StageModels {
  /**
   * План для этапа `stage`: сжатие по замеру контекста (`withContext`) и утверждённая модель этапа из следа `record`. Этап без
   * утверждённой модели или тред, чью модель не прочесть, модель не трогают. Нечитаемое — норма: план не должен ломать ни
   * отметку этапа, ни ответ на бриф. План без дела — `null`.
   */
  plan(threadId: string, stage: WorkStage, withContext: boolean, record: FlowProgress): Promise<BoundaryPlan | null>;
}

export const createStageModels = (deps: {
  /** Заполненность окна контекста треда с порогами; `null` — чисел ещё нет. */
  context?: (threadId: string) => Promise<ContextFillView | null>;
  /** Модель и effort, что стоят треду; `null` — не Claude Code или не прочлось: модель не меняется. */
  current?: (threadId: string) => Promise<StageModel | null>;
}): StageModels => ({
  async plan(threadId, stage, withContext, record) {
    const [fill, current] = await Promise.all([withContext ? (deps.context?.(threadId).catch(() => null) ?? null) : null, deps.current?.(threadId).catch(() => null) ?? null]);
    const chosen = record.stages[stage.id]?.model;
    const approved = current === null || chosen === undefined ? null : { model: chosen.model, reasoningLevel: chosen.reasoningLevel };
    return boundaryPlan({ tone: fill === null ? "normal" : contextTone(fill.usedTokens, fill), current, approved });
  },
});
