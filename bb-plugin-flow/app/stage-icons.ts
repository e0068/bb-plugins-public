// Иконки этапов по виду: одна карта для страницы Flow, брифа и баннера прогресса.
import type { BuiltinKind } from "../lib/stage-constants";
import type { StageAutomation } from "../shared/contract";

/** Встроенный вид — своя иконка; Выбор этапов — Workflow пунктиром, как у Flow в меню. */
export const KIND_ICONS: Record<BuiltinKind, string> = {
  questions: "MessageQuestion",
  criteria: "ListTodo",
  select: "WorkflowDashed",
  demo: "Presentation",
};

/** Этап навыка на странице Flow. */
export const SKILL_ICON = "BookOpen";

/** Значок встроенной автоматизации — молния, автоматизации Automations — Workflow, как у плагина. */
export const BUILTIN_AUTOMATION_ICON = "Zap";
export const EXTERNAL_AUTOMATION_ICON = "Workflow";

/** Значок этапа-автоматизации: по тому, чья она — Flow или плагина Automations. */
export const automationIcon = (automation: StageAutomation): string => ("source" in automation ? BUILTIN_AUTOMATION_ICON : EXTERNAL_AUTOMATION_ICON);
