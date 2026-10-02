// Слой 2 — чисто. Сохранённые наборы шагов встроенной автоматизации: прежняя
// закладка строки таблицы этапов сохраняла шаги, и наборы по-прежнему ставятся
// в этап из меню исполнения. Новые закладка кладёт шаблоном этапа (./stage-templates).
// Имени у набора нет — его подпись собирается из шагов.
import type { AutomationSet, AutomationStep, BuiltinAutomation } from "../shared/contract";
import { scriptIdOf } from "./automation-scripts";

/** Набор — автоматизацией нового этапа; скрипты получают новые id, иначе прерванный прогон спутал бы копии. */
export const applySet = (set: AutomationSet, newId: () => string): BuiltinAutomation => {
  if (set.scripts === undefined) return { source: "flow", steps: [...set.steps] };
  const ids = new Map(set.scripts.map((script) => [script.id, newId()]));
  return {
    source: "flow",
    steps: set.steps.map((step): AutomationStep => {
      const id = scriptIdOf(step);
      return id === null ? step : `script:${ids.get(id) ?? id}`;
    }),
    scripts: set.scripts.map((script) => ({ ...script, id: ids.get(script.id)! })),
  };
};

export const removeSet = (sets: readonly AutomationSet[], index: number): readonly AutomationSet[] => sets.filter((_, i) => i !== index);
