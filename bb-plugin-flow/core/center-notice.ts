// Слой core — чисто. Записи Flow для Центра уведомлений: конец хода и итог
// этапа-автоматизации в форме packages/notifications-contract. Тосты Flow
// показывает центр, поэтому итог автоматизации несёт карточку целиком: заголовок,
// строки шагов со ссылками и кнопки. Слова — по-русски: центр говорит языком
// владельца, а не настройкой языка Flow.
import type { NotificationAction, NotificationInput, NotificationSegment, NotificationToast } from "@bb-plugins/notifications-contract/index";
import { ru } from "../lib/messages/ru";
import { flowRoute } from "../lib/panel-path";
import { noticeCard, type AutomationNotice, type NoticeAction, type NoticeWords, type Segment } from "./automation-notice";

/** HTTP-вход Flow, который центр зовёт кнопками «Повторить» и «Пропустить». */
export const NOTICE_ACTION_PATH = "/notification-action";

/** Что кнопка тоста просит у Flow: повторить или пропустить упавший шаг этапа. */
export type NoticeActionRequest = { action: "retry" | "skip"; threadId: string; stage: string; stageName: string };

const SOURCE = { source: "flow", sourceName: "Flow" } as const;

/**
 * Конец хода в треде с flow: держит тред бриф, ждущий владельца, — «ждёт
 * ответа», одна запись на бриф; иначе «ход закончен», своя на каждый ход.
 * Тостом не всплывают, пока владелец не включит их в центре.
 */
export const turnEndEntry = ({ threadId, threadTitle, brief }: { threadId: string; threadTitle: string | null; brief: { id: string; title: string } | null }): NotificationInput => ({
  ...SOURCE,
  ...(brief === null
    ? { kind: "turn-done", kindLabel: "Ход закончен", title: "Ход закончен", dedupeKey: null }
    : { kind: "awaiting", kindLabel: "Ждёт ответа", title: `Ждёт ответа — бриф «${brief.title}»`, dedupeKey: `brief:${brief.id}` }),
  threadId,
  threadTitle,
  url: null,
  toastByDefault: false,
});

/** Слова карточки — русские, как всё в центре; шаг называется словарём Flow, а незнакомый — подписью снимка прогона. */
const WORDS: NoticeWords = {
  done: ru.notice.done,
  failed: ru.notice.failed,
  stepLabel: (step) => (step.id in ru.steps ? ru.steps[step.id as keyof typeof ru.steps] : step.label),
};

const segmentOf = (segment: Segment): NotificationSegment => {
  switch (segment.kind) {
    case "text":
    case "thread":
    case "url":
      return segment;
    case "task":
      return { kind: "route", route: segment.route, text: segment.text };
    case "flow":
      return { kind: "route", route: flowRoute(segment.flowId), text: segment.text };
  }
};

/** Куски в форме центра; соседние куски текста — один кусок. */
const segmentsOf = (segments: readonly Segment[]): NotificationSegment[] =>
  segments.map(segmentOf).reduce<NotificationSegment[]>((acc, segment) => {
    const last = acc.at(-1);
    return last?.kind === "text" && segment.kind === "text" ? [...acc.slice(0, -1), { kind: "text", text: last.text + segment.text }] : [...acc, segment];
  }, []);

const actionOf = (action: NoticeAction, notice: AutomationNotice): NotificationAction => {
  const request = (kind: NoticeActionRequest["action"]): NoticeActionRequest => ({ action: kind, threadId: notice.threadId, stage: notice.stageId, stageName: notice.stageName });
  switch (action.kind) {
    case "url":
      return { label: ru.notice.github, icon: "github", target: { kind: "url", url: action.url } };
    case "thread":
      return { label: ru.notice.toThread, icon: "thread", target: { kind: "thread", threadId: action.threadId } };
    case "retry":
      return { label: ru.notice.retry, icon: "retry", target: { kind: "callback", path: NOTICE_ACTION_PATH, payload: request("retry") } };
    case "skip":
      return { label: ru.notice.skip, icon: "skip", target: { kind: "callback", path: NOTICE_ACTION_PATH, payload: request("skip") } };
  }
};

/** Карточка тоста итога; ключ — этап треда: повторное падение и итог после него заменяют карточку, а не копятся. */
const toastOf = (notice: AutomationNotice): NotificationToast => {
  const card = noticeCard(notice, WORDS);
  return {
    key: `${notice.threadId}:${notice.stageId}`,
    title: segmentsOf(card.title),
    lines: card.lines.map(segmentsOf),
    actions: card.actions.map((action) => actionOf(action, notice)),
  };
};

const stepLabel = (notice: AutomationNotice & { kind: "failed" }): string => notice.steps.find((step) => step.id === notice.stepId)?.label ?? notice.stepId;

/** Итог этапа-автоматизации: одна запись на событие, ссылка — на PR, если он у прогона есть, и карточка тоста. */
export const automationEntry = (notice: AutomationNotice): NotificationInput => ({
  ...SOURCE,
  ...(notice.kind === "done"
    ? { kind: "automation-done", kindLabel: "Автоматизация прошла", title: `Автоматизация «${notice.stageName}» прошла`, tone: "success" }
    : { kind: "automation-failed", kindLabel: "Автоматизация упала", title: `Автоматизация «${notice.stageName}» упала на шаге «${stepLabel(notice)}»`, tone: "error" }),
  threadId: notice.threadId,
  threadTitle: notice.threadTitle,
  url: notice.pr?.url ?? null,
  dedupeKey: `automation:${notice.id}`,
  toast: toastOf(notice),
  toastByDefault: true,
});
