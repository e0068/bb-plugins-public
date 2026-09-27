// Тосты об итогах этапов-автоматизаций. Слушатель стоит баннером без
// разметки в каждом открытом треде: событие приходит, где бы владелец ни был,
// и показывается одним тостом на этап треда, сколько бы тредов ни было открыто. Тост висит,
// пока его не закроют: итог фоновой автоматизации легко пропустить, отойдя от
// экрана. Карточка повторяет тосты Automations Builder — рамка, иконка тона,
// крестик — на переменных дизайн-системы хоста.
import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { useBbNavigate, useRealtime, useRpc, type BbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

import { AUTOMATION_NOTICE_CHANNEL, noticeCard, type AutomationNotice, type NoticeAction, type NoticeCard, type NoticeWords, type Segment } from "../core/automation-notice";
import { Icon, type IconName } from "../components/ui/icon";
import type { Messages } from "../lib/messages";
import type { automationRpcContract } from "../shared/contract";
import { LocaleProvider } from "./locale";
import { useLocale, useMessages } from "./locale-context";
import { FLOWS_PANEL_PATH } from "./panel-path";

/**
 * Контейнеры якорей живых слушателей. Хост ловит внутренние ссылки только
 * внутри корня плагина, а тост живёт в портале вне его, поэтому ссылка на
 * задачу кликается якорем, поставленным в контейнер любого живого слушателя.
 */
const anchorHosts = new Set<HTMLElement>();

/** Клик по маршруту хоста из-за пределов корня плагина; с Cmd — хост открывает страницу сбоку, как ссылки итога прогона. */
const followRoute = (route: string): void => {
  const host = [...anchorHosts].find((el) => el.isConnected);
  if (host === undefined) return;
  const anchor = document.createElement("a");
  anchor.setAttribute("href", route);
  host.append(anchor);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
  anchor.remove();
};

type Rpc = ReturnType<typeof useRpc<typeof automationRpcContract>>;
type Deps = { navigate: BbNavigate; rpc: Rpc; t: Messages; words: NoticeWords };

const wordsOf = (t: Messages, locale: string): NoticeWords => ({
  done: t.notice.done,
  failed: t.notice.failed,
  retryAt: (iso) => t.notice.retryAt(new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })),
  stepLabel: (step) => (step.id in t.steps ? t.steps[step.id as keyof Messages["steps"]] : step.label),
});

const TONE_ICON: Record<NoticeCard["tone"], IconName> = { success: "CircleCheck", error: "AlertCircle" };

const cardStyle: CSSProperties = {
  position: "relative",
  boxSizing: "border-box",
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  width: 356,
  padding: "14px 40px 14px 16px",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 12px)",
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
  font: "inherit",
  fontSize: 14,
  lineHeight: 1.4,
};
const bodyStyle: CSSProperties = { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 };
const titleStyle: CSSProperties = { fontWeight: 600, wordBreak: "break-word" };
const lineStyle: CSSProperties = { fontSize: 13, color: "var(--muted-foreground)", wordBreak: "break-word" };
const actionRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 };
const actionButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 28,
  padding: "0 10px",
  cursor: "pointer",
  borderRadius: "calc(var(--radius, 12px) - 4px)",
  border: "1px solid var(--border)",
  background: "var(--secondary, transparent)",
  color: "var(--secondary-foreground, inherit)",
  font: "inherit",
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1,
  whiteSpace: "nowrap",
};
const closeStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  display: "inline-flex",
  padding: 4,
  background: "none",
  border: 0,
  borderRadius: 6,
  color: "var(--muted-foreground)",
  cursor: "pointer",
  lineHeight: 0,
};
// Упоминание — ссылка в строке: цвет и начертание текста вокруг, подчёркивание говорит, что кликается.
const mentionStyle: CSSProperties = {
  display: "inline",
  padding: 0,
  background: "none",
  border: 0,
  color: "inherit",
  font: "inherit",
  textDecoration: "underline",
  textUnderlineOffset: 2,
  cursor: "pointer",
};

/** Переход по упоминанию; текст ссылкой не является. */
const followOf = (segment: Segment, deps: Deps): (() => void) | null => {
  switch (segment.kind) {
    case "text":
      return null;
    case "thread":
      return () => deps.navigate.toThread(segment.threadId);
    case "url":
      return () => void deps.navigate.openUrl(segment.url);
    case "flow":
      return () => deps.navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: segment.flowId });
    case "task":
      return () => followRoute(segment.route);
  }
};

const ACTION_ICON: Record<NoticeAction["kind"], IconName> = { url: "Github", thread: "MessageSquare", retry: "Refresh", skip: "Next" };

const actionLabel = (action: NoticeAction, t: Messages): string => {
  switch (action.kind) {
    case "url":
      return t.notice.github;
    case "thread":
      return t.notice.toThread;
    case "retry":
      return t.notice.retry;
    case "skip":
      return t.notice.skip;
  }
};

/** Повтор и пропуск — те же RPC, что у кнопок баннера; «не начат» значит, что шаг уже не ждёт. */
const answerStep = (method: "retryAutomation" | "skipAutomationStep", notice: AutomationNotice, deps: Deps): void => {
  void deps.rpc.call(method, { threadId: notice.threadId, stage: notice.stageId }).then(
    ({ started }) => {
      if (!started) showPlain("error", deps.t.notice.notWaiting(notice.stageName), deps.t);
    },
    (error: unknown) => showPlain("error", error instanceof Error ? error.message : String(error), deps.t),
  );
};

const actionOf = (action: NoticeAction, notice: AutomationNotice, deps: Deps): (() => void) => {
  switch (action.kind) {
    case "url":
      return () => void deps.navigate.openUrl(action.url);
    case "thread":
      return () => deps.navigate.toThread(action.threadId);
    case "retry":
      return () => answerStep("retryAutomation", notice, deps);
    case "skip":
      return () => answerStep("skipAutomationStep", notice, deps);
  }
};

type Follow = (segment: Segment) => (() => void) | null;

function Segments({ segments, follow: followSegment, close }: { segments: readonly Segment[]; follow: Follow; close: () => void }): ReactNode {
  return segments.map((segment, index) => {
    const follow = followSegment(segment);
    return follow === null ? (
      <span key={index}>{segment.text}</span>
    ) : (
      <button
        key={index}
        type="button"
        style={mentionStyle}
        onClick={() => {
          follow();
          close();
        }}
      >
        {segment.text}
      </button>
    );
  });
}

type CardProps = {
  tone: NoticeCard["tone"];
  title: readonly Segment[];
  lines: readonly (readonly Segment[])[];
  buttons: ReadonlyArray<{ label: string; icon: IconName; run: () => void }>;
  follow: Follow;
  t: Messages;
  close: () => void;
};

function Card({ tone, title, lines, buttons, follow, t, close }: CardProps): ReactNode {
  return (
    <div style={cardStyle} role="status">
      <Icon name={TONE_ICON[tone]} style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div style={bodyStyle}>
        <div style={titleStyle}>
          <Segments segments={title} follow={follow} close={close} />
        </div>
        {lines.map((line, index) => (
          <div key={index} style={lineStyle}>
            <Segments segments={line} follow={follow} close={close} />
          </div>
        ))}
        {buttons.length > 0 && (
          <div style={actionRowStyle}>
            {buttons.map(({ label, icon, run }) => (
              <button
                key={label}
                type="button"
                style={actionButtonStyle}
                onClick={() => {
                  run();
                  close();
                }}
              >
                <Icon name={icon} style={{ width: 15, height: 15, flexShrink: 0 }} aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" aria-label={t.notice.dismiss} onClick={close} style={closeStyle}>
        <Icon name="X" style={{ width: 16, height: 16 }} aria-hidden />
      </button>
    </div>
  );
}

/** `key` — место тоста: новый тост с тем же ключом заменяет прежний, а не встаёт рядом. Нет — место своё. */
const showCard = (render: (close: () => void) => ReactElement, key?: string): void => {
  toast.custom((id) => render(() => toast.dismiss(id)), { duration: Infinity, ...(key === undefined ? {} : { id: key }) });
};

/** Тост из одной строки — ответ на нажатие в тосте, у которого больше нет своей карточки. */
function showPlain(tone: NoticeCard["tone"], text: string, t: Messages): void {
  showCard((close) => <Card tone={tone} title={[{ kind: "text", text }]} lines={[]} buttons={[]} follow={() => null} t={t} close={close} />);
}

const showNotice = (notice: AutomationNotice, deps: Deps): void => {
  const card = noticeCard(notice, deps.words);
  const buttons = card.actions.map((action) => ({ label: actionLabel(action, deps.t), icon: ACTION_ICON[action.kind], run: actionOf(action, notice, deps) }));
  // Тост на этап треда один: повторное падение при автоповторе и итог после него заменяют карточку, а не копятся с мёртвыми кнопками.
  // Тот же ключ сводит в один тост и событие, пришедшее всем открытым тредам.
  showCard((close) => <Card tone={card.tone} title={card.title} lines={card.lines} buttons={buttons} follow={(segment) => followOf(segment, deps)} t={deps.t} close={close} />, `${notice.threadId}:${notice.stageId}`);
};

const isNotice = (payload: unknown): payload is AutomationNotice =>
  typeof payload === "object" && payload !== null && typeof (payload as { id?: unknown }).id === "string" && ((payload as { kind?: unknown }).kind === "done" || (payload as { kind?: unknown }).kind === "failed");

function Listener(): ReactNode {
  const t = useMessages();
  const locale = useLocale();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof automationRpcContract>();
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = host.current;
    if (el === null) return;
    anchorHosts.add(el);
    return () => void anchorHosts.delete(el);
  }, []);
  useRealtime(AUTOMATION_NOTICE_CHANNEL, (payload) => {
    if (!isNotice(payload)) return;
    showNotice(payload, { navigate, rpc, t, words: wordsOf(t, locale) });
  });
  return <span ref={host} hidden data-flow-notice-anchors />;
}

/** Баннер-слушатель: разметки не рисует, только принимает события и держит контейнер якорей. */
export function AutomationToasts(): ReactNode {
  return (
    <LocaleProvider>
      <Listener />
    </LocaleProvider>
  );
}
