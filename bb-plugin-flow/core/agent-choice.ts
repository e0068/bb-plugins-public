// Слой 1 — чисто. Выбор агента в ряду виджета: какой flow и какая модель выбраны, что предлагает агент, какой вид у кнопок
// и какие пометки у пунктов колонок. Пометки — по прототипу владельца: галочка у выбранного, ✦ у предложения агента всегда,
// «Сейчас» у текущего, когда выбран другой.
import type { Execution, WidgetAgent } from "../shared/contract";

/** Те же провайдер, модель, effort и скорость; скорость без поля — обычная. */
export const sameExecution = (a: Execution, b: Execution): boolean =>
  a.providerId === b.providerId && a.model === b.model && a.reasoningLevel === b.reasoningLevel && (a.serviceTier ?? "default") === (b.serviceTier ?? "default");

/** Выбранный flow: тронутый владельцем, иначе рекомендованный агентом, иначе текущий; `null` — тред без flow и выбора нет. */
export const chosenFlowId = (catalog: Pick<WidgetAgent, "currentFlowId">, picked: string | null | undefined, recommended: string | undefined): string | null =>
  picked === undefined ? (recommended ?? catalog.currentFlowId) : (picked ?? catalog.currentFlowId);

/** Модель, которую предлагает выбранный flow: его модель, когда flow не текущий и модель не та, что у треда; иначе `null`. */
export const proposedExecution = (catalog: WidgetAgent, flowId: string | null): Execution | null => {
  if (flowId === null || flowId === catalog.currentFlowId) return null;
  const execution = catalog.flows.find((flow) => flow.id === flowId)?.execution;
  return execution === undefined || sameExecution(execution, catalog.current) ? null : execution;
};

/** Выбранная модель: тронутая владельцем, иначе предложение агента, иначе модель треда. */
export const chosenExecution = (catalog: WidgetAgent, picked: Execution | undefined, proposed: Execution | null): Execution => picked ?? proposed ?? catalog.current;

/** Вид кнопки: широкая, когда выбор не текущий; ✦ — когда выбрано предложение агента. */
export type CellLook = { wide: boolean; agent: boolean };

export const modelLook = (current: Execution, chosen: Execution, proposed: Execution | null): CellLook => ({
  wide: !sameExecution(chosen, current),
  agent: proposed !== null && sameExecution(chosen, proposed),
});

export const flowLook = (current: string | null, chosen: string | null, recommended: string | undefined): CellLook => ({
  wide: chosen !== current,
  agent: recommended !== undefined && recommended !== current && chosen === recommended,
});

/** Пометки пункта колонки: галочка у выбранного, «Сейчас» у текущего, если выбран другой, ✦ у предложения — всегда. */
export type ItemMarks = { on: boolean; now: boolean; agent: boolean };

export const itemMarks = <T>(item: T, { chosen, current, proposed }: { chosen: T; current: T; proposed: T | null }): ItemMarks => {
  const on = item === chosen;
  return { on, now: !on && item === current, agent: proposed !== null && item === proposed };
};

/** Провайдер сменился: в этом треде такую работу не продолжить — только в новом. */
export const providerChanged = (current: Execution, chosen: Execution): boolean => chosen.providerId !== current.providerId;

/** Модель при смене провайдера: модель по умолчанию нового провайдера каталога с её effort; провайдера нет — без изменений. */
export const switchProvider = (catalog: WidgetAgent, chosen: Execution, providerId: string): Execution => {
  if (providerId === catalog.current.providerId) return { ...catalog.current, ...(chosen.serviceTier === undefined ? {} : { serviceTier: chosen.serviceTier }) };
  const model = catalog.providers.find((provider) => provider.id === providerId)?.models[0];
  return model === undefined ? chosen : { providerId, model: model.model, reasoningLevel: model.defaultEffort, ...(chosen.serviceTier === undefined ? {} : { serviceTier: chosen.serviceTier }) };
};

/** Модель внутри провайдера: effort остаётся, если модель его знает, иначе — её effort по умолчанию. */
export const switchModel = (catalog: WidgetAgent, chosen: Execution, model: string): Execution => {
  const entry = catalog.providers.find((provider) => provider.id === chosen.providerId)?.models.find((m) => m.model === model);
  if (entry === undefined) return chosen;
  return { ...chosen, model, reasoningLevel: entry.efforts.includes(chosen.reasoningLevel) ? chosen.reasoningLevel : entry.defaultEffort };
};

/** Что уходит в ответ: выбор, отличный от текущего; совпавший с текущим — ничего. */
export const answeredExecution = (current: Execution, chosen: Execution): Execution | undefined => (sameExecution(current, chosen) ? undefined : chosen);
