// Слой 2 — чисто. Шаблоны этапов: закладка строки таблицы сохраняет этап целиком — название, навык, иконку,
// исполнение, — а «Добавить этап» ставит его новым этапом в любой flow. Места в flow у шаблона нет: ни id, ни владельца.
import type { StageTemplate, WorkStage } from "../shared/contract";
import { applySet } from "./automation-sets";

/** Этап без места в flow; флаг `review` прежних снимков в шаблон не идёт. */
const templateOf = ({ id: _id, parent: _parent, review: _review, ...template }: WorkStage): StageTemplate => template;

/** Значение строкой с ключами по алфавиту: порядок ключей зависит от того, какая схема разбирала запись, а смысл — нет. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

/** Шаблон для сравнения: скрипты — именем и содержимым, id у каждой копии свой. */
const signature = (template: StageTemplate): string => {
  const automation = template.automation;
  if (automation === undefined || !("source" in automation) || automation.scripts === undefined) return canonical(template);
  const scripts = new Map(automation.scripts.map((script) => [`script:${script.id}`, [script.name, script.content]]));
  return canonical({ ...template, automation: { ...automation, scripts: undefined, steps: automation.steps.map((step) => scripts.get(step) ?? step) } });
};

export const isTemplateSaved = (templates: readonly StageTemplate[], stage: WorkStage): boolean => {
  const own = signature(templateOf(stage));
  return templates.some((template) => signature(template) === own);
};

/** Этап шаблоном в конец списка; уже сохранённый — список тот же. */
export const saveTemplate = (templates: readonly StageTemplate[], stage: WorkStage): readonly StageTemplate[] =>
  isTemplateSaved(templates, stage) ? templates : [...templates, templateOf(stage)];

export const removeTemplate = (templates: readonly StageTemplate[], index: number): readonly StageTemplate[] => templates.filter((_, i) => i !== index);

/** Новый этап из шаблона под id `id`; скрипты встроенной автоматизации получают новые id, как при наборе шагов. */
export const stageFromTemplate = (template: StageTemplate, id: string, newId: () => string): WorkStage => {
  const automation = template.automation;
  const own = automation !== undefined && "source" in automation ? applySet({ steps: automation.steps, ...(automation.scripts === undefined ? {} : { scripts: automation.scripts }) }, newId) : automation;
  return { id, ...template, ...(own === undefined ? {} : { automation: own }) };
};
