// Что Flow делает с тредом перед работой агента над этапом: сжать (контекст не обычный) и поставить модель этапа.
// Один помощник на оба пути к этапу — отметку flow_stage и ответ владельца на бриф, — чтобы правило не жило дважды.
import { boundaryPlan, contextTone, stageModelRole, wantedModel, type BoundaryPlan } from "../core/context";
import type { ContextFillView, WorkStage } from "../shared/contract";

/** Модель треда и модели его провайдера; `null` — модель не меняется (не Claude Code, каталог не прочёлся). */
export type ThreadModels = { current: string | null; models: ReadonlyArray<{ model: string }> };

export interface StageModels {
  /**
   * План для этапа `stage`: сжатие по замеру контекста (`withContext`) и модель этапа. Нечитаемое — норма и «модель не трогать»:
   * план не должен ломать ни отметку этапа, ни ответ на бриф. План без дела — `null`. Модель, с которой тред уходит на Sonnet,
   * запоминается: на этапе роли Opus тред вернётся к ней, а не к первой Opus каталога.
   */
  plan(threadId: string, stage: WorkStage, withContext: boolean): Promise<BoundaryPlan | null>;
  /**
   * Модель треда выбрал владелец в ответе на бриф (`chosen`) — пока он её не отдал, Flow модель не трогает. Ответ без выбора
   * отдаёт управление Flow: стоящая модель становится исходной.
   */
  owner(threadId: string, chosen: boolean): void;
}

export const createStageModels = (deps: {
  /** Заполненность окна контекста треда с порогами; `null` — чисел ещё нет. */
  context?: (threadId: string) => Promise<ContextFillView | null>;
  models?: (threadId: string) => Promise<ThreadModels | null>;
}): StageModels => {
  /** Модель, с которой тред уходил на Sonnet, — к ней он вернётся на этапе роли Opus. */
  const before = new Map<string, string>();
  /** Модель, которую Flow сам поставил треду последней, и первая модель, какую Flow у треда увидел. */
  const set = new Map<string, string>();
  const first = new Map<string, string>();
  /** Треды, чью модель выбрал владелец. */
  const owned = new Set<string>();
  const forget = (threadId: string): void => {
    before.delete(threadId);
    set.delete(threadId);
    first.delete(threadId);
  };
  /** Модель треда сменил владелец руками: её нет среди тех, что Flow ставил или застал. */
  const changedByOwner = (threadId: string, current: string | null): boolean => {
    if (current === null) return false;
    const known = [first.get(threadId), set.get(threadId), before.get(threadId)].filter((model): model is string => model !== undefined);
    if (known.length === 0) first.set(threadId, current);
    return known.length > 0 && !known.includes(current);
  };
  return {
    owner(threadId, chosen) {
      if (chosen) owned.add(threadId);
      else if (owned.delete(threadId)) forget(threadId);
    },
    async plan(threadId, stage, withContext) {
      const [fill, models] = await Promise.all([withContext ? (deps.context?.(threadId).catch(() => null) ?? null) : null, deps.models?.(threadId).catch(() => null) ?? null]);
      const role = stageModelRole(stage);
      // Выбор владельца — в брифе или руками в композере — главнее модели этапа; сжатие по контексту остаётся.
      const hands = owned.has(threadId) || changedByOwner(threadId, models?.current ?? null);
      const wanted = hands || role === null || models === null ? null : wantedModel(role, models.current, models.models, before.get(threadId) ?? null);
      const plan = boundaryPlan({ tone: fill === null ? "normal" : contextTone(fill.usedTokens, fill), currentModel: models?.current ?? null, wantedModel: wanted });
      if (plan !== null && plan.model !== null) {
        set.set(threadId, plan.model);
        const current = models?.current ?? null;
        if (role === "sonnet" && current !== null) before.set(threadId, current);
      }
      return plan;
    },
  };
};
