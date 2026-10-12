// Слой 1 — чисто. Агент треда по flow: какие настройки агента у выбора треда, какую модель из них можно поставить живому
// треду и какое стартовое сообщение отдать сессии; модель по умолчанию из каталога bb — для выбора модели на странице Flow.
import { REASONING_LEVELS } from "../lib/agent-limits";
import type { AgentSettings, Execution, FlowSettings } from "../shared/contract";
import { AUTO_FLOW, flowOrNone } from "./flows";

/** Настройки агента выбора треда: настоящий flow — его, «Автоматически» — строки «Автоматически», «Без flow» — ничего. */
export const agentFor = (settings: FlowSettings, flowId: string | undefined): AgentSettings | undefined =>
  flowId === AUTO_FLOW ? settings.autoAgent : flowOrNone(settings, flowId)?.agent;

/** Модель и effort для живого треда: только у того же провайдера — провайдера у треда bb не меняет. */
export const executionFor = (agent: AgentSettings | undefined, providerId: string): Pick<Execution, "model" | "reasoningLevel"> | null =>
  agent?.execution === undefined || agent.execution.providerId !== providerId ? null : { model: agent.execution.model, reasoningLevel: agent.execution.reasoningLevel };

/** Стартовое сообщение агенту; пустое — `null`. */
export const startMessageOf = (agent: AgentSettings | undefined): string | null => {
  const text = agent?.start?.trim() ?? "";
  return text === "" ? null : text;
};

/** Каталог моделей одного провайдера так, как его отдаёт `bb.sdk.providers.models`. */
export type ModelCatalog = {
  providers: ReadonlyArray<{ id: string; available: boolean; displayName?: string }>;
  models: ReadonlyArray<{
    model: string;
    isDefault: boolean;
    defaultReasoningEffort: string;
    routeProviderId?: string | undefined;
    displayName?: string;
    supportedReasoningEfforts?: ReadonlyArray<{ reasoningEffort: string }>;
  }>;
};

const isLevel = (level: string): level is Execution["reasoningLevel"] => (REASONING_LEVELS as readonly string[]).includes(level);

/** Модель по умолчанию провайдера каталога: помеченная `isDefault`, иначе первая; провайдер недоступен или моделей нет — `null`. */
export const defaultExecutionOf = (catalog: ModelCatalog, providerId: string): Execution | null => {
  if (catalog.providers.find((p) => p.id === providerId)?.available !== true) return null;
  const own = catalog.models.filter((m) => (m.routeProviderId ?? providerId) === providerId);
  const model = own.find((m) => m.isDefault) ?? own[0];
  return model === undefined ? null : { providerId, model: model.model, reasoningLevel: isLevel(model.defaultReasoningEffort) ? model.defaultReasoningEffort : "medium" };
};

/** Модели провайдера для колонок виджета: модель по умолчанию первой, effort — только те, что знает Flow. */
export const providerModelsOf = (catalog: ModelCatalog, providerId: string): Array<{ model: string; name: string; efforts: Execution["reasoningLevel"][]; defaultEffort: Execution["reasoningLevel"] }> =>
  catalog.models
    .filter((m) => (m.routeProviderId ?? providerId) === providerId)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    .map((m) => ({
      model: m.model,
      name: m.displayName ?? m.model,
      efforts: (m.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort).filter(isLevel),
      defaultEffort: isLevel(m.defaultReasoningEffort) ? m.defaultReasoningEffort : "medium",
    }));
