// Коллекция flow в kv плагина. Инструкции агенту читают её синхронно, поэтому
// последнее прочитанное или сохранённое держится в памяти. Запись читается
// через схему: чужое значение — это умолчания, а не падение.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { STEP_LABELS } from "@bb-plugins/automation-steps/catalog";
import { stepOrderMessage, stepOrderProblem } from "../core/automation-order";
import { duplicateFlowName, withUniqueNames } from "../core/flow-files";
import { flowCycle, fromLegacy, migrateFlows, withExpandedStages } from "../core/flows";
import { flowSettingsSchema, stageSettingsSchema, type FlowSettings } from "../shared/contract";

export const FLOW_SETTINGS_KEY = "settings:flows";

/** Единственный список этапов до flow. Не удаляется: откат версии плагина читает его. */
export const LEGACY_STAGE_SETTINGS_KEY = "settings:work-stages";

export type FlowSettingsStore = {
  /** Последняя прочитанная или сохранённая коллекция. */
  current(): FlowSettings;
  save(settings: FlowSettings): Promise<FlowSettings>;
  /** Слушатель каждого удавшегося сохранения — так синхронизация узнаёт о правках со страницы, из save_flow и из своего импорта. */
  onSaved(listener: (saved: FlowSettings) => void): void;
};

const readOrMigrate = async (kv: PluginKvStorage): Promise<FlowSettings> => {
  const raw = await kv.get(FLOW_SETTINGS_KEY);
  if (raw !== undefined) {
    // Непрошедшая схему запись — умолчания в памяти, но не в kv: иначе форма новой версии стёрлась бы при откате.
    const stored = flowSettingsSchema.safeParse(raw);
    if (!stored.success) return fromLegacy(undefined);
    // Коллекция до видов этапов переносится и пишется сразу: иначе перенос повторялся бы и возвращал этапы, которые владелец удалил.
    // Повтор имён — из времени до папки синхронизации, где имя стало именем файла: номера ставятся тогда же и пишутся.
    const migrated = withUniqueNames(migrateFlows(stored.data));
    if (migrated !== stored.data) await kv.set(FLOW_SETTINGS_KEY, migrated);
    return migrated;
  }
  const legacy = stageSettingsSchema.safeParse(await kv.get(LEGACY_STAGE_SETTINGS_KEY));
  const migrated = fromLegacy(legacy.success ? legacy.data : undefined);
  await kv.set(FLOW_SETTINGS_KEY, migrated);
  return migrated;
};

export const createFlowSettings = async (kv: PluginKvStorage): Promise<FlowSettingsStore> => {
  let current = await readOrMigrate(kv);
  const listeners: Array<(saved: FlowSettings) => void> = [];
  return {
    current: () => current,
    onSaved: (listener) => void listeners.push(listener),
    async save(settings) {
      // Сохранённое — уже коллекция на видах: без версии следующее чтение перенесло бы её снова и вернуло удалённые этапы.
      const valid = { ...flowSettingsSchema.parse(settings), version: 2 as const };
      // Flow, включивший сам себя, развёртывался бы бесконечно: отказ здесь один на всех — через эту запись идут и страница, и save_flow.
      const cycle = flowCycle(valid.flows);
      if (cycle.length > 0) {
        const names = cycle.map((id) => valid.flows.find((f) => f.id === id)?.name ?? id);
        throw new Error(`flow "${names[0]}" includes itself: ${names.join(" → ")}`);
      }
      // Цепочка, где бамп или мёрдж стоит раньше открытия PR, падает на первом
      // же прогоне любого треда. Порядок читается по развёрнутым этапам: PR мог
      // открыть вложенный flow. Отказ тоже один на всех.
      const problem = stepOrderProblem(withExpandedStages(valid.flows));
      if (problem !== null) {
        throw new Error(stepOrderMessage(problem, STEP_LABELS[problem.step].en, STEP_LABELS["git.create-pr"].en));
      }
      // Имя flow — имя его файла в папке синхронизации: два одинаковых имени легли бы в один файл.
      const duplicate = duplicateFlowName(valid.flows);
      if (duplicate !== null) throw new Error(`flow name "${duplicate}" is taken: flow names are unique, ignoring case`);
      await kv.set(FLOW_SETTINGS_KEY, valid);
      current = valid;
      listeners.forEach((listener) => listener(valid));
      return valid;
    },
  };
};
