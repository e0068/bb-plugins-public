// Числа, виды и id этапов работ, которые нужны и схемам контракта, и клиенту:
// клиент не берёт значений из `shared`, поэтому одно место — здесь.

/** Исполнитель «сам» — агент, который ведёт тред. */
export const SELF_EXECUTOR = "self";

/** Пределы и начальное значение минимальной ширины кнопки этапа, px. */
export const STAGE_BUTTON_WIDTH = { min: 100, max: 400, initial: 170 } as const;

/** Верхние пределы автоповтора упавшего шага: секунды до повтора и число попыток подряд. */
export const RETRY_LIMITS = { seconds: 3600, attempts: 100 } as const;

/** Предел длины наказа агенту после последней попытки, символов. */
export const MAX_WAKE_INSTRUCTION_CHARS = 4000;

/**
 * Вид этапа: навык, встроенный — Вопросы, Definition of Done, Выбор этапов, Демонстрация — или Action.
 * Встроенные ставятся в flow сколько угодно раз. Action — шаги автоматизации, которые запускает владелец кнопкой.
 */
export const STAGE_KINDS = ["skill", "questions", "criteria", "select", "demo", "action"] as const;

export type StageKind = (typeof STAGE_KINDS)[number];

export const BUILTIN_KINDS = ["questions", "criteria", "select", "demo"] as const;

export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

/** Id встроенных этапов до видов: записи без поля `kind` узнаются по ним. */
const LEGACY_KINDS: Readonly<Record<string, BuiltinKind>> = { clarify: "questions", criteria: "criteria" };

/** Вид этапа; у записи без поля — по прежнему id Уточнения и Definition of Done, остальное — навык. */
export const stageKindOf = (stage: { id: string; kind?: StageKind | undefined }): StageKind => stage.kind ?? LEGACY_KINDS[stage.id] ?? "skill";

/** Навык, по которому агент проводит встроенный этап, пока владелец не поставил свой. Плагин везёт их в `skills/`; одноимённый навык владельца в `~/.claude/skills` или `.claude/skills` репозитория важнее. */
export const BUILTIN_SKILLS: Record<BuiltinKind, string> = { questions: "flow-questions", criteria: "flow-criteria", select: "flow-stage-selection", demo: "flow-demo" };

/** Навык, по которому агент собирает flow инструментами read_flows и save_flow; плагин везёт его в `skills/`. */
export const FLOW_CREATE_SKILL = "flow-create";

/** Корневой навык плагина — как говорить с владельцем брифом ask_decision; плагин везёт его в `skills/`. */
export const ROOT_SKILL = "flow";

/** Инструмент агента, которым тред с выбором «Автоматически» получает flow, выбранный по описаниям flow. */
export const CHOOSE_FLOW_TOOL = "choose_flow";

/**
 * Навык, очищенный крестиком у встроенного этапа. Пустая строка у такого этапа уже значит навык его вида, поэтому
 * «без навыка» хранится меткой — дефисом, которого нет в имени навыка.
 */
export const NO_SKILL = "-";

/** Навык этапа: у встроенного пустое поле значит навык его вида — так смена навыка по умолчанию доезжает до сохранённых flow; `NO_SKILL` — навыка нет. */
export const stageSkillOf = (stage: { id: string; kind?: StageKind | undefined; skill: string }): string => {
  const kind = stageKindOf(stage);
  if (stage.skill === NO_SKILL) return "";
  return kind === "skill" || kind === "action" || stage.skill !== "" ? stage.skill : BUILTIN_SKILLS[kind];
};

/** Навык, который ставит крестик в поле: встроенному этапу — метка «без навыка», остальным — пустое поле. */
export const clearedSkill = (stage: { id: string; kind?: StageKind | undefined }): string => {
  const kind = stageKindOf(stage);
  return kind === "skill" || kind === "action" ? "" : NO_SKILL;
};

/** Название в хранилище — английское: сервер языка не знает, по языку подписывает фронт. */
const BUILTIN_NAMES: Readonly<Record<BuiltinKind, string>> = { questions: "Questions", criteria: "Definition of Done", select: "Stage selection", demo: "Demonstration" };

/** Прежние английские имена Уточнения и Definition of Done — тоже имена по умолчанию, каждое своему виду. */
const LEGACY_NAMES: Readonly<Partial<Record<BuiltinKind, string>>> = { questions: "Clarification", criteria: "Criteria" };

/** Имя этапа Action в хранилище, пока владелец не назвал его своим. */
const ACTION_NAME = "Action";

/**
 * Имя, под которым «Добавить этап» заводит этап, — по языку интерфейса. Этап с таким именем владелец ещё не назвал:
 * его подписывает первый выбор навыка, виджета или шагов, на каком бы языке ни был заведён.
 */
export const NEW_STAGE_NAMES: Readonly<Record<"ru" | "en", string>> = { ru: "Новый этап", en: "New stage" };

export const isNewStageName = (name: string): boolean => Object.values(NEW_STAGE_NAMES).includes(name);

/** Имя этапа вида не менялось владельцем: подписывается по виду и языку интерфейса. */
export const isDefaultName = (stage: { id: string; kind?: StageKind | undefined; name: string }): boolean => {
  const kind = stageKindOf(stage);
  if (kind === "skill") return false;
  if (kind === "action") return stage.name === ACTION_NAME;
  return stage.name === BUILTIN_NAMES[kind] || stage.name === LEGACY_NAMES[kind];
};

/** Имя этапа для агента: встроенный с именем по умолчанию — нынешнее английское имя вида, хоть flow и сохранён под прежним. */
export const currentName = (stage: { id: string; kind?: StageKind | undefined; name: string }): string => {
  const kind = stageKindOf(stage);
  return kind === "skill" || kind === "action" || !isDefaultName(stage) ? stage.name : BUILTIN_NAMES[kind];
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

/**
 * Под-этапы стоят вплотную к владельцу того же списка: владелец есть, он не сам этап и не под-этап, а между ними —
 * только под-этапы того же владельца. Иначе номера, галочка связки и инструкции агенту разошлись бы со списком.
 */
export const linkedSubStages = (stages: ReadonlyArray<{ id: string; parent?: string | undefined }>): boolean =>
  stages.every((stage, at) => {
    if (stage.parent === undefined) return true;
    const owner = stages.findIndex((other) => other.id === stage.parent);
    const between = stages.slice(Math.min(at, owner) + 1, Math.max(at, owner));
    return owner >= 0 && owner !== at && stages[owner]!.parent === undefined && between.every((other) => other.parent === stage.parent);
  });

/** Причина отказа flow с разорванной связкой — одна для схемы и для save_flow. */
export const SUB_STAGE_ISSUE = "a sub-stage stands next to its parent, a top-level stage of the same flow, with only that parent's sub-stages between them";
