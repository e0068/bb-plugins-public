// Слой 2 — чисто. Шаблоны этапов: закладка строки таблицы сохраняет этап целиком — название, навык, иконку,
// исполнение и под-этапы, — а «Добавить этап» ставит его новым этапом в любой flow. Места в flow у шаблона нет: ни id, ни владельца.
import type { StageTemplate, WorkStage } from "../shared/contract";
import { applySet } from "./automation-sets";

type SubStageTemplate = NonNullable<StageTemplate["subStages"]>[number];
type OwnTemplate = Omit<StageTemplate, "subStages">;

/** Этап без места в flow; флаг `review` прежних снимков в шаблон не идёт. */
const ownOf = ({ id: _id, parent: _parent, review: _review, ...template }: WorkStage): OwnTemplate => template;

/** Этап шаблоном вместе с под-этапами в порядке списка; у этапа без под-этапов поля `subStages` нет. */
const templateOf = (stages: readonly WorkStage[], stage: WorkStage): StageTemplate => {
  const at = stages.indexOf(stage);
  const subStages = stages
    .map((sub, i): SubStageTemplate | null => (sub.parent === stage.id ? { ...ownOf(sub), ...(i < at ? { before: true as const } : {}) } : null))
    .filter((sub) => sub !== null);
  return { ...ownOf(stage), ...(subStages.length === 0 ? {} : { subStages }) };
};

/** Значение строкой с ключами по алфавиту: порядок ключей зависит от того, какая схема разбирала запись, а смысл — нет. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

/** Скрипты автоматизации — именем и содержимым: id у каждой копии свой. */
const withoutScriptIds = <T extends OwnTemplate>(template: T): T => {
  const automation = template.automation;
  if (automation === undefined || !("source" in automation) || automation.scripts === undefined) return template;
  const scripts = new Map(automation.scripts.map((script) => [`script:${script.id}`, [script.name, script.content]]));
  return { ...template, automation: { ...automation, scripts: undefined, steps: automation.steps.map((step) => scripts.get(step) ?? step) } };
};

/** Шаблон для сравнения: этап и под-этапы без id скриптов. */
const signature = (template: StageTemplate): string =>
  canonical({ ...withoutScriptIds(template), subStages: template.subStages?.map(withoutScriptIds) });

export const isTemplateSaved = (templates: readonly StageTemplate[], stages: readonly WorkStage[], stage: WorkStage): boolean => {
  const own = signature(templateOf(stages, stage));
  return templates.some((template) => signature(template) === own);
};

/** Этап `stage` списка `stages` шаблоном в конец; уже сохранённый — список тот же. */
export const saveTemplate = (templates: readonly StageTemplate[], stages: readonly WorkStage[], stage: WorkStage): readonly StageTemplate[] =>
  isTemplateSaved(templates, stages, stage) ? templates : [...templates, templateOf(stages, stage)];

export const removeTemplate = (templates: readonly StageTemplate[], index: number): readonly StageTemplate[] => templates.filter((_, i) => i !== index);

/** Этап под id `id`; скрипты встроенной автоматизации получают новые id, как при наборе шагов. */
const stageOf = (template: OwnTemplate, id: string, newId: () => string): WorkStage => {
  const automation = template.automation;
  const own = automation !== undefined && "source" in automation ? applySet({ steps: automation.steps, ...(automation.scripts === undefined ? {} : { scripts: automation.scripts }) }, newId) : automation;
  return { id, ...template, ...(own === undefined ? {} : { automation: own }) };
};

/**
 * Этапы из шаблона: владелец и под-этапы на своих местах — до него и после, — каждый под новым id из `newStageId`;
 * скрипты получают новые id из `newId`.
 */
export const stagesFromTemplate = (template: StageTemplate, newStageId: () => string, newId: () => string): WorkStage[] => {
  const { subStages = [], ...own } = template;
  const owner = stageOf(own, newStageId(), newId);
  const subs = subStages.map(({ before, ...sub }) => ({ before: before === true, stage: { ...stageOf(sub, newStageId(), newId), parent: owner.id } }));
  return [...subs.filter((s) => s.before).map((s) => s.stage), owner, ...subs.filter((s) => !s.before).map((s) => s.stage)];
};
