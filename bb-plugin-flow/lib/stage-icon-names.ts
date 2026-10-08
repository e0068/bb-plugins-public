// Имена значков этапов по виду: одна карта для страницы Flow, брифа, баннера прогресса и сервера, который отдаёт
// значки этапов другим плагинам. Слой нижний, потому что серверу нельзя брать из `app`.
import type { BuiltinKind, StageKind } from "./stage-constants";

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

/** Иконки исполнителя этапа навыка без логотипа провайдера: ромб — сам, агент, workflow. */
export const EXECUTOR_ICONS = { self: "Diamond", agent: "Bot", workflow: "Workflow" } as const;

/** Значок этапа прогона без своего: Action — запуск, этап с шагами — автоматизация, навык — знак исполнителя, встроенный — знак вида. */
export const stageIconName = (stage: { kind: StageKind; executor: keyof typeof EXECUTOR_ICONS; automation: boolean }): string =>
  stage.kind === "action" ? KIND_ICONS.action : stage.automation ? AUTOMATION_ICON : stage.kind === "skill" ? EXECUTOR_ICONS[stage.executor] : KIND_ICONS[stage.kind];
