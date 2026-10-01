// Слой core — чисто. Записи Flow для Центра уведомлений: конец хода и итог
// этапа-автоматизации в форме packages/notifications-contract. Слова — по-русски:
// центр говорит языком владельца, а не настройкой языка Flow.
import type { NotificationInput } from "@bb-plugins/notifications-contract/index";
import type { AutomationNotice } from "./automation-notice";

/**
 * Конец хода в треде с flow: держит тред бриф, ждущий владельца, — «ждёт
 * ответа», одна запись на бриф; иначе «ход закончен», своя на каждый ход.
 */
export const turnEndEntry = ({ threadId, threadTitle, brief }: { threadId: string; threadTitle: string | null; brief: { id: string; title: string } | null }): NotificationInput =>
  brief === null
    ? { source: "flow", kind: "turn-done", title: "Ход закончен", threadId, threadTitle, url: null, dedupeKey: null }
    : { source: "flow", kind: "awaiting", title: `Ждёт ответа — бриф «${brief.title}»`, threadId, threadTitle, url: null, dedupeKey: `brief:${brief.id}` };

const stepLabel = (notice: AutomationNotice & { kind: "failed" }): string => notice.steps.find((step) => step.id === notice.stepId)?.label ?? notice.stepId;

/** Итог этапа-автоматизации: одна запись на событие, ссылка — на PR, если он у прогона есть. */
export const automationEntry = (notice: AutomationNotice): NotificationInput => ({
  source: "flow",
  kind: notice.kind === "done" ? "automation-done" : "automation-failed",
  title: notice.kind === "done" ? `Автоматизация «${notice.stageName}» прошла` : `Автоматизация «${notice.stageName}» упала на шаге «${stepLabel(notice)}»`,
  threadId: notice.threadId,
  threadTitle: notice.threadTitle,
  url: notice.pr?.url ?? null,
  dedupeKey: `automation:${notice.id}`,
});
