// Имена значков этапов по виду: одна карта для страницы Flow, брифа, баннера прогресса и сервера, который отдаёт
// значки этапов другим плагинам. Слой нижний, потому что серверу нельзя брать из `app`.
import type { BuiltinKind, StageKind } from "./stage-constants";

/** Встроенный вид — своя иконка; Выбор этапов — Workflow пунктиром, как у Flow в меню; Утверждение — галочка на значке; Action — запуск шага владельцем. */
export const KIND_ICONS: Record<BuiltinKind | "action", string> = {
  questions: "MessageQuestion",
  criteria: "ListTodo",
  select: "WorkflowDashed",
  demo: "Presentation",
  approve: "CheckmarkBadge",
  action: "Play",
};

/** Этап навыка — книга, кто бы его ни вёл. */
export const SKILL_ICON = "BookOpen";

/** Значок автоматизации — квадрат, ведущий к квадрату со стрелкой; один у шагов Flow и у автоматизаций Automations. */
export const AUTOMATION_ICON = "Arrange";

/**
 * Значок этапа без своего — один на странице Flow, в баннере прогресса и на шкалах других плагинов: Action — запуск,
 * этап с шагами — автоматизация, навык — книга, встроенный — знак вида. Исполнитель значок не меняет.
 */
export const stageIconName = (stage: { kind: StageKind; automation: boolean }): string =>
  stage.kind === "action" ? KIND_ICONS.action : stage.automation ? AUTOMATION_ICON : stage.kind === "skill" ? SKILL_ICON : KIND_ICONS[stage.kind];
