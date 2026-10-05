// Слой 2 — чисто. Чем исполняется этап — одна колонка «Исполнение» на странице
// Flow: агенты и workflow, виджет (Вопросы, Definition of Done, Выбор этапов,
// Демонстрация), скрипт — шаги Flow, которые запускает сам Flow или владелец
// кнопкой (этап Action), — или автоматизация плагина Automations. Здесь — что
// стоит у этапа сейчас и как этап переходит от одного исполнения к другому.
// Хранение не меняется: вид, навык, исполнители и автоматизация пишутся в те же
// поля, что и раньше, поэтому сохранённые flow читаются без переделки.
import { BUILTIN_KINDS, BUILTIN_SKILLS, builtinStage, isDefaultName, isNewStageName, stageKindOf, stageSkillOf, type BuiltinKind } from "../lib/stage-constants";
import type { BuiltinAutomation, StageExecutor, WorkStage } from "../shared/contract";

export type ExternalAutomation = Exclude<NonNullable<WorkStage["automation"]>, BuiltinAutomation>;

export type Execution =
  | { kind: "executors"; executors: readonly StageExecutor[] }
  | { kind: "widget"; widget: BuiltinKind }
  | { kind: "script"; automation: BuiltinAutomation; manual: boolean }
  | { kind: "external"; automation: ExternalAutomation };

const EMPTY_SCRIPT: BuiltinAutomation = { source: "flow", steps: [] };

export const executionOf = (stage: WorkStage): Execution => {
  const kind = stageKindOf(stage);
  const automation = stage.automation;
  if (automation !== undefined && !("source" in automation)) return { kind: "external", automation };
  if (kind === "action") return { kind: "script", automation: automation ?? EMPTY_SCRIPT, manual: true };
  if (automation !== undefined) return { kind: "script", automation, manual: false };
  return kind === "skill" ? { kind: "executors", executors: stage.executors } : { kind: "widget", widget: kind };
};

/** Скрипт — этап, чьи шаги исполняет Flow или Automations, даже пока шагов нет; остальные этапы — агентские. */
export const isScriptStage = (stage: WorkStage): boolean => {
  const kind = executionOf(stage).kind;
  return kind === "script" || kind === "external";
};

/**
 * Main Agent — агент, который ведёт тред, — исполняет этап, пока владелец не снял его. Этап без других исполнителей ведёт
 * он всегда: снять его там нельзя, а снятый вместе с последним исполнителем возвращается.
 */
export const hasMainAgent = (stage: WorkStage): boolean => stage.mainAgent !== false || stage.executors.length === 0;

/** Main Agent снят; у этапа без других исполнителей — этап тот же. */
export const withoutMainAgent = (stage: WorkStage): WorkStage => (stage.executors.length === 0 ? stage : { ...stage, mainAgent: false });

/** Main Agent снова у этапа. */
export const withMainAgent = ({ mainAgent: _, ...stage }: WorkStage): WorkStage => stage;

/** Общее у этапа при любом исполнении: id, название и владелец под-этапа. */
const identity = (stage: WorkStage, name: string): Pick<WorkStage, "id" | "name" | "parent"> =>
  stage.parent === undefined ? { id: stage.id, name } : { id: stage.id, name, parent: stage.parent };

/**
 * Агент или workflow ставится, а стоящий — снимается. Виджет и скрипт уступают место исполнителям: этап становится
 * этапом навыка с тем навыком, что был виден в поле, и с названием `shownName` — тем, что видит владелец, ведь
 * название вида по умолчанию подписывается по языку и за пределами вида осталось бы английским.
 */
export const withExecutor = (stage: WorkStage, executor: StageExecutor, shownName: string): WorkStage => {
  const current = executionOf(stage);
  if (current.kind === "executors") {
    const on = current.executors.some((e) => e.id === executor.id);
    const executors = on ? current.executors.filter((e) => e.id !== executor.id) : [...current.executors, executor];
    return executors.length === 0 ? { ...withMainAgent(stage), executors } : { ...stage, executors };
  }
  return { ...identity(stage, shownName), kind: "skill", skill: stageSkillOf(stage), executors: [executor] };
};

const isBuiltinSkill = (skill: string): boolean => BUILTIN_KINDS.some((kind) => BUILTIN_SKILLS[kind] === skill);

/**
 * Виджет вида `widget`. Свой навык этапа остаётся — виджет ведётся им; пустой и навык какого-то вида становятся навыком
 * нового вида (пустое поле — навык вида по умолчанию). Название вида по умолчанию и имя нового, ещё не названного
 * этапа сменяются названием нового вида.
 */
export const withWidget = (stage: WorkStage, widget: BuiltinKind): WorkStage => {
  const skill = isBuiltinSkill(stageSkillOf(stage)) ? "" : stage.skill;
  const unnamed = isNewStageName(stage.name) || (stageKindOf(stage) !== "skill" && isDefaultName(stage));
  const name = unnamed ? builtinStage(widget, []).name : stage.name;
  return { ...identity(stage, name), kind: widget, skill, executors: [] };
};

/** Скрипт с автоматизацией `automation` и запуском `manual`: исполнителей у него нет — его шаги исполняет Flow; навык, что был виден в поле, остаётся. */
const asScript = (stage: WorkStage, automation: BuiltinAutomation, manual: boolean): WorkStage => ({
  ...identity(stage, stage.name),
  kind: manual ? "action" : "skill",
  skill: stageSkillOf(stage),
  executors: [],
  automation,
});

/** Правка шагов скрипта; этап без скрипта получает его пустым, с запуском Flow, и правка ложится на пустой. */
export const withSteps =
  (change: (automation: BuiltinAutomation) => BuiltinAutomation) =>
  (stage: WorkStage): WorkStage => {
    const current = executionOf(stage);
    return current.kind === "script" ? asScript(stage, change(current.automation), current.manual) : asScript(stage, change(EMPTY_SCRIPT), false);
  };

/** Кто запускает скрипт: `manual` — владелец кнопкой (Action), иначе Flow сам. Этап без скрипта получает пустой. */
export const withRun = (stage: WorkStage, manual: boolean): WorkStage => {
  const current = executionOf(stage);
  return asScript(stage, current.kind === "script" ? current.automation : EMPTY_SCRIPT, manual);
};

/** Виджет снят: этап становится этапом навыка с навыком, что был виден в поле, без исполнителей и с видимым названием. */
export const withoutWidget = (stage: WorkStage, shownName: string): WorkStage => ({ ...identity(stage, shownName), kind: "skill", skill: stageSkillOf(stage), executors: [] });
