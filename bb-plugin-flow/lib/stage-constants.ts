// Числа, виды и id этапов работ, которые нужны и схемам контракта, и клиенту:
// клиент не берёт значений из `shared`, поэтому одно место — здесь.

/** Исполнитель «сам» — агент, который ведёт тред. */
export const SELF_EXECUTOR = "self";

/** Пределы и начальное значение минимальной ширины кнопки этапа, px. */
export const STAGE_BUTTON_WIDTH = { min: 100, max: 400, initial: 170 } as const;

/**
 * Вид этапа: навык, встроенный — Вопросы, Критерии, Выбор этапов, Демонстрация — или Action.
 * Встроенные ставятся в flow сколько угодно раз. Action — шаги автоматизации, которые запускает владелец кнопкой.
 */
export const STAGE_KINDS = ["skill", "questions", "criteria", "select", "demo", "action"] as const;

export type StageKind = (typeof STAGE_KINDS)[number];

export const BUILTIN_KINDS = ["questions", "criteria", "select", "demo"] as const;

export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

/** Id встроенных этапов до видов: записи без поля `kind` узнаются по ним. */
const LEGACY_KINDS: Readonly<Record<string, BuiltinKind>> = { clarify: "questions", criteria: "criteria" };

/** Вид этапа; у записи без поля — по прежнему id Уточнения и Критериев, остальное — навык. */
export const stageKindOf = (stage: { id: string; kind?: StageKind | undefined }): StageKind => stage.kind ?? LEGACY_KINDS[stage.id] ?? "skill";

/** Навык, по которому агент проводит встроенный этап, пока владелец не поставил свой. Сами навыки лежат в `~/.claude/skills` или `.claude/skills` репозитория. */
export const BUILTIN_SKILLS: Record<BuiltinKind, string> = { questions: "flow-questions", criteria: "flow-criteria", select: "flow-stage-selection", demo: "flow-demo" };

/** Корневой навык: через него агент выбирает flow, когда тред не идёт по flow. */
export const ROOT_SKILL = "flow";

/** Инструмент агента, которым тред без flow получает flow, выбранный по корневому навыку. */
export const CHOOSE_FLOW_TOOL = "choose_flow";

/** Навык этапа: у встроенного пустое поле значит навык его вида — так смена навыка по умолчанию доезжает до сохранённых flow. У Action навыка нет: его шаги исполняет Flow по нажатию владельца. */
export const stageSkillOf = (stage: { id: string; kind?: StageKind | undefined; skill: string }): string => {
  const kind = stageKindOf(stage);
  return kind === "skill" || kind === "action" || stage.skill !== "" ? stage.skill : BUILTIN_SKILLS[kind];
};

/** Название в хранилище — английское: сервер языка не знает, по языку подписывает фронт. */
const BUILTIN_NAMES: Record<BuiltinKind, string> = { questions: "Questions", criteria: "Criteria", select: "Stage selection", demo: "Demonstration" };

/** Прежние английские имена Уточнения и Критериев — тоже имена по умолчанию. */
const LEGACY_NAMES: readonly string[] = ["Clarification"];

/** Имя этапа Action в хранилище, пока владелец не назвал его своим. */
const ACTION_NAME = "Action";

/** Имя этапа вида не менялось владельцем: подписывается по виду и языку интерфейса. */
export const isDefaultName = (stage: { id: string; kind?: StageKind | undefined; name: string }): boolean => {
  const kind = stageKindOf(stage);
  if (kind === "skill") return false;
  if (kind === "action") return stage.name === ACTION_NAME;
  return stage.name === BUILTIN_NAMES[kind] || LEGACY_NAMES.includes(stage.name);
};

/** Свободный id по основе: сама основа, а занятая — с номером со второго. */
export const freeId = (base: string, taken: readonly string[]): string => {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
};

/** Встроенный этап вида `kind` с id, не совпадающим ни с одним из `taken`. */
export const builtinStage = (kind: BuiltinKind, taken: readonly string[]) => ({ id: freeId(kind, taken), kind, skill: "", name: BUILTIN_NAMES[kind], executors: [] as never[] });

/**
 * Этап Action: те же шаги, что у встроенной автоматизации, но запускает их владелец кнопкой в баннере прогресса,
 * по одному шагу за нажатие. Прогон, дойдя до такого этапа, останавливается и ждёт владельца.
 */
export const actionStage = (taken: readonly string[]) => ({
  id: freeId("flow-action", taken),
  kind: "action" as const,
  skill: "",
  name: ACTION_NAME,
  executors: [] as never[],
  automation: { source: "flow" as const, steps: [] as never[] },
});

/** Автоматизация плагина Automations, встроенная этапом: снимок её id и имени на момент добавления. */
export interface StageAutomation {
  id: string;
  name: string;
}

export const automationStageId = (automationId: string): string => `automation-${automationId}`;

/** Этап, который запускает автоматизацию Automations: этап навыка без навыка и исполнителей — его исполняет Flow (server/automation-runner.ts). */
export const automationStage = (automation: StageAutomation) => ({
  id: automationStageId(automation.id),
  kind: "skill" as const,
  skill: "",
  name: automation.name,
  executors: [] as never[],
  automation: { id: automation.id, name: automation.name },
});
