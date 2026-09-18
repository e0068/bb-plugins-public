// Слой 2 — чисто. Сохранённые наборы шагов встроенной автоматизации: владелец
// сохраняет шаги строки таблицы этапов и ставит их в новый этап из меню кнопки
// «Автоматизация». Имени у набора нет — его подпись собирается из шагов.
import type { AutomationSet, AutomationStep, BuiltinAutomation } from "../shared/contract";
import { scriptIdOf, scriptOf } from "./automation-scripts";

/** Шаги набора без id скриптов: скрипт сравнивается именем и содержимым, id у каждой копии свой. */
const signature = (automation: BuiltinAutomation): string =>
  JSON.stringify(automation.steps.map((step) => {
    const script = scriptOf(automation, step);
    return script === null ? step : [script.name, script.content];
  }));

const asAutomation = (set: AutomationSet): BuiltinAutomation => ({ source: "flow", ...set });

/** Шаги автоматизации — новым набором в конец; пустая или уже сохранённая — список тот же. */
export const saveSet = (sets: readonly AutomationSet[], automation: BuiltinAutomation): readonly AutomationSet[] =>
  automation.steps.length === 0 || isSaved(sets, automation)
    ? sets
    : [...sets, { steps: [...automation.steps], ...(automation.scripts === undefined ? {} : { scripts: [...automation.scripts] }) }];

export const isSaved = (sets: readonly AutomationSet[], automation: BuiltinAutomation): boolean =>
  sets.some((set) => signature(asAutomation(set)) === signature(automation));

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
