// Иконки этапов по виду: одна карта для страницы Flow, брифа и баннера прогресса.
import { stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import type { WorkStage } from "../shared/contract";

/** Встроенный вид — своя иконка; Выбор этапов — Workflow пунктиром, как у Flow в меню; Action — запуск шага владельцем. */
export const KIND_ICONS: Record<BuiltinKind | "action", string> = {
  questions: "MessageQuestion",
  criteria: "ListTodo",
  select: "WorkflowDashed",
  demo: "Presentation",
  action: "Play",
};

/** Этап навыка на странице Flow. */
export const SKILL_ICON = "BookOpen";

/** Значок автоматизации — квадрат, ведущий к квадрату со стрелкой; один у шагов Flow и у автоматизаций Automations. */
export const AUTOMATION_ICON = "Arrange";

/** Значок этапа по его виду: автоматизация, Action — запуск, встроенный вид — свой знак, навык — книга. */
export const stageIcon = (stage: WorkStage): string => {
  const kind = stageKindOf(stage);
  if (kind === "action") return KIND_ICONS.action;
  if (stage.automation !== undefined) return AUTOMATION_ICON;
  return kind === "skill" ? SKILL_ICON : KIND_ICONS[kind];
};
