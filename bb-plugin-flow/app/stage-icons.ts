// Иконки этапов по виду: одна карта для страницы Flow, брифа и баннера прогресса.
import { stageKindOf, type BuiltinKind } from "../lib/stage-constants";
import type { StageAutomation, WorkStage } from "../shared/contract";

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

/** Значок встроенной автоматизации — молния, автоматизации Automations — Workflow, как у плагина. */
export const BUILTIN_AUTOMATION_ICON = "Zap";
export const EXTERNAL_AUTOMATION_ICON = "Workflow";

/** Значок этапа-автоматизации: по тому, чья она — Flow или плагина Automations. */
export const automationIcon = (automation: StageAutomation): string => ("source" in automation ? BUILTIN_AUTOMATION_ICON : EXTERNAL_AUTOMATION_ICON);

/** Значок этапа по его виду: автоматизация — чья она, Action — запуск, встроенный вид — свой знак, навык — книга. */
export const stageIcon = (stage: WorkStage): string => {
  const kind = stageKindOf(stage);
  if (kind === "action") return KIND_ICONS.action;
  if (stage.automation !== undefined) return automationIcon(stage.automation);
  return kind === "skill" ? SKILL_ICON : KIND_ICONS[kind];
};
