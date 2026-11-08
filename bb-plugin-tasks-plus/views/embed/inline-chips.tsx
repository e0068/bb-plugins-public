import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { Skeleton } from "@/components/ui/skeleton";
import { CallerThreadProvider } from "../../client/caller-thread.js";
import { taskKeyOfHref } from "../../shared/inline-task-directive.js";
import { StatusIcon } from "../common/icons.js";
import { embedAriaLabel, useOpenTaskInSidePanel, useTaskEmbed } from "./index.js";
import { watchInlineTaskDirectives, type ChipHost } from "./inline-directive-dom.js";

const CHIP_CLASS =
  "mx-0.5 inline-flex max-w-[28rem] items-center gap-1.5 rounded-md border border-border bg-card px-1.5 align-middle leading-6 transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Чип задачи на месте директивы посреди фразы: статус, ключ, название; клик
 * открывает задачу сбоку, как карточка директивы. Задачи нет или она не
 * загрузилась — на месте остаётся исходный текст директивы.
 */
function InlineTaskChip({ host }: { host: ChipHost }) {
  const { state } = useTaskEmbed(host.key);
  const openTask = useOpenTaskInSidePanel();
  if (state.kind === "not_found" || state.kind === "error") return <>{host.source}</>;
  const task = state.kind === "found" ? state.task : null;
  return (
    <button
      type="button"
      className={CHIP_CLASS}
      aria-label={task === null ? `Loading task ${host.key}` : embedAriaLabel(task)}
      onClick={() => openTask(task?.key ?? host.key)}
    >
      {task === null ? <Skeleton className="size-3.5 shrink-0 rounded-full" /> : <StatusIcon status={task.status} />}
      <span aria-hidden className="shrink-0 font-mono text-xs text-muted-foreground">
        {task?.key ?? host.key}
      </span>
      {task === null ? null : (
        <span aria-hidden className="min-w-0 truncate font-medium">
          {task.title}
        </span>
      )}
    </button>
  );
}

/** Ссылка, как её рисуют bb и движок Kasimov в карточках виджетов: `<a href>` или span с `data-href`. */
const LINK_SELECTOR = "a[href], [data-href]";

/**
 * Клик по ссылке `bb://tasks/<ключ>` где угодно в окне открывает задачу сбоку.
 * Перехват на погружении, до обработчика самой ссылки: карточка виджета
 * считает такой адрес файлом дерева и открывала бы несуществующий файл.
 */
function useTaskLinkClicks() {
  const openTask = useOpenTaskInSidePanel();
  const openRef = useRef(openTask);
  openRef.current = openTask;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest(LINK_SELECTOR) : null;
      const key = link === null ? null : taskKeyOfHref(link.getAttribute("data-href") ?? link.getAttribute("href") ?? "");
      if (key === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openRef.current(key);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}

/**
 * Директивы задач посреди фраз в ответах агента — чипами. bb узнаёт
 * `::task` только отдельной строкой, и слота под директиву внутри строки у
 * SDK нет, поэтому оверлей сам находит такие места в ленте
 * (inline-directive-dom.ts) и рисует в них чипы порталами — с хуками SDK,
 * как карточка директивы. Задачу ищет в дереве открытого треда.
 */
export function InlineTaskChips() {
  const { threadId } = useBbContext();
  const [hosts, setHosts] = useState<readonly ChipHost[]>([]);
  useEffect(() => watchInlineTaskDirectives(document.body, setHosts), []);
  useTaskLinkClicks();
  const chips: ReactNode = hosts.map((host) =>
    createPortal(<InlineTaskChip host={host} />, host.element, String(host.id)),
  );
  return threadId === null ? <>{chips}</> : <CallerThreadProvider threadId={threadId}>{chips}</CallerThreadProvider>;
}
