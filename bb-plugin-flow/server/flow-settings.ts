// Коллекция flow в kv плагина. Инструкции агенту читают её синхронно, поэтому
// последнее прочитанное или сохранённое держится в памяти. Запись читается
// через схему: чужое значение — это умолчания, а не падение.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { STEP_LABELS } from "../packages/automation-steps/catalog";
import { stepOrderMessage, stepOrderProblem } from "../core/automation-order";
import { fromLegacy, migrateFlows } from "../core/flows";
import { flowSettingsSchema, stageSettingsSchema, type FlowSettings } from "../shared/contract";

export const FLOW_SETTINGS_KEY = "settings:flows";

/** Единственный список этапов до flow. Не удаляется: откат версии плагина читает его. */
export const LEGACY_STAGE_SETTINGS_KEY = "settings:work-stages";

export type FlowSettingsStore = {
  /** Последняя прочитанная или сохранённая коллекция. */
  current(): FlowSettings;
  save(settings: FlowSettings): Promise<FlowSettings>;
};

const readOrMigrate = async (kv: PluginKvStorage): Promise<FlowSettings> => {
  const raw = await kv.get(FLOW_SETTINGS_KEY);
  if (raw !== undefined) {
    // Непрошедшая схему запись — умолчания в памяти, но не в kv: иначе форма новой версии стёрлась бы при откате.
    const stored = flowSettingsSchema.safeParse(raw);
    if (!stored.success) return fromLegacy(undefined);
    // Коллекция до видов этапов переносится и пишется сразу: иначе перенос повторялся бы и возвращал этапы, которые владелец удалил.
    const migrated = migrateFlows(stored.data);
    if (migrated !== stored.data) await kv.set(FLOW_SETTINGS_KEY, migrated);
    return migrated;
  }
  const legacy = stageSettingsSchema.safeParse(await kv.get(LEGACY_STAGE_SETTINGS_KEY));
  const migrated = fromLegacy(legacy.success ? legacy.data : undefined);
  await kv.set(FLOW_SETTINGS_KEY, migrated);
  return migrated;
};

/** `onSave` — вслед за каждой записью, уже с сохранённой коллекцией; его сбой запись не отменяет. */
export const createFlowSettings = async (kv: PluginKvStorage, options: { onSave?: (settings: FlowSettings) => Promise<void> } = {}): Promise<FlowSettingsStore> => {
  let current = await readOrMigrate(kv);
  return {
    current: () => current,
    async save(settings) {
      // Сохранённое — уже коллекция на видах: без версии следующее чтение перенесло бы её снова и вернуло удалённые этапы.
      const valid = { ...flowSettingsSchema.parse(settings), version: 2 as const };
      // Цепочка, где бамп или мёрдж стоит раньше открытия PR, падает на первом
      // же прогоне любого треда. Отказ здесь один на всех: через эту запись
      // идут и страница, и инструмент save_flow.
      const problem = stepOrderProblem(valid.flows);
      if (problem !== null) {
        throw new Error(stepOrderMessage(problem, STEP_LABELS[problem.step].en, STEP_LABELS["git.create-pr"].en));
      }
      await kv.set(FLOW_SETTINGS_KEY, valid);
      current = valid;
      await options.onSave?.(valid).catch(() => undefined);
      return valid;
    },
  };
};
