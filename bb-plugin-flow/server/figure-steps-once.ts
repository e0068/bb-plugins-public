// Шаги плана и факта встают во flow владельца один раз — при первом запуске Flow, который их знает, из main.
// В превью из дерева треда — нет: следом в bb встанет сборка соседнего треда или main без этих шагов, а коллекцию
// с незнакомым ей шагом она не прочтёт и покажет всем тредам вместо flow одни умолчания.
import type { PluginKvStorage } from "@get-bb/plugin-sdk";

import { withFigureSteps } from "../core/figure-steps";
import { flowSettingsSchema } from "../shared/contract";
import { FLOW_SETTINGS_KEY, type FlowSettingsStore } from "./flow-settings";

export const FIGURE_STEPS_PLACED_KEY = "migration:figure-steps";

/** Источник установки — превью из дерева треда. */
const isThreadTree = (source: string): boolean => source.includes("/worktrees/");

export const placeFigureStepsOnce = async (kv: PluginKvStorage, flows: FlowSettingsStore, ownSource: () => Promise<string | undefined>): Promise<void> => {
  if ((await kv.get(FIGURE_STEPS_PLACED_KEY)) !== undefined) return;
  const source = await ownSource();
  if (source === undefined || isThreadTree(source)) return;
  // Коллекция не прочлась — в памяти умолчания: сохранение стёрло бы flow владельца.
  if (!flowSettingsSchema.safeParse(await kv.get(FLOW_SETTINGS_KEY)).success) return;
  const placed = withFigureSteps(flows.current());
  if (placed !== flows.current()) await flows.save(placed);
  await kv.set(FIGURE_STEPS_PLACED_KEY, true);
};
