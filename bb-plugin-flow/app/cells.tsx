// Части ячеек нижнего блока брифа: подпись добавки, чекбокс, текст ячейки и
// ссылка документа. Ими собраны и кнопки брифа прежнего вида, и кнопки этапов.
import { UrlLink, experimental_FileLink as FileLink } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";

import { addParts, riskText } from "../core/budget";
import { liveLink, type FileRoots } from "../core/result-link";
import { taskRoute } from "../core/run-tasks";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { useLocale } from "./locale-context";
import type { Add } from "../shared/contract";

/**
 * Ссылка результата по его адресу. Файл — ссылкой bb, как в чате: клик открывает превью,
 * правый клик — меню «Open in / Open with / Copy file path». Адрес — ссылкой bb в браузер bb.
 * Открыть нечем — корней ещё нет или нужного нет — остаётся подпись. `line` — строка, на которой файл откроется.
 */
export function ResultAnchor({ target, line = null, roots, label, className, children }: { target: string; line?: number | null; roots: FileRoots | null; label?: string; className?: string; children: ReactNode }) {
  const link = liveLink(target, roots);
  const props = { className, ...(label === undefined ? {} : { "aria-label": label }) };
  switch (link.kind) {
    case "url":
      return <UrlLink href={link.url} {...props}>{children}</UrlLink>;
    case "file":
      return <FileLink target={link.target} location={line === null ? null : { kind: "line", line, column: null }} {...props}>{children}</FileLink>;
    case "none":
      return <span aria-disabled="true" {...props}>{children}</span>;
  }
}

/** Строка результата этапа: файл, адрес или команда — одна высота, отступы и подложка. */
export const RESULT_ROW = "flex min-h-8 w-full min-w-0 items-center gap-3 bg-state-active px-3 py-1 text-[13px]";

/** Риск со знаком: плюс — негатив, минус — позитив дизайн-системы. */
export function RiskText({ risk, className }: { risk: number; className?: string }) {
  const text = riskText(risk);
  return text === "" ? null : <span className={cn(risk > 0 ? "text-destructive" : "text-success", className)}>{text}</span>;
}

/** Мелкая подпись добавки: деньги, риск цветом по знаку, время; добавка, которая ничего не меняет, не рисуется. */
export function AddMeta({ add, className }: { add: Add | undefined | null; className?: string }) {
  const locale = useLocale();
  if (add === undefined || add === null) return null;
  const parts = addParts(add, locale);
  if (parts.money === "" && parts.risk.text === "" && parts.time === "") return null;
  return (
    <span className={cn("inline-flex shrink-0 flex-wrap gap-x-1.5 whitespace-nowrap text-[11px]", className)}>
      {parts.money !== "" && <span className="text-muted-foreground">{parts.money}</span>}
      <RiskText risk={add.risk} />
      {parts.time !== "" && <span className="text-muted-foreground">{parts.time}</span>}
    </span>
  );
}

export function CheckSquare({ on, required = false }: { on: boolean; required?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border",
        required && !on && "border-foreground",
        on && "border-foreground bg-foreground text-background",
      )}
    >
      {on && <Icon name="Check" className="size-3" />}
    </span>
  );
}

/**
 * Ячейка переносимого ряда кнопок: не уже `width` и растёт на свободное место, поэтому кнопка,
 * одна в своём ряду, растянута на всю ширину, а не стоит клеткой сетки.
 */
export const rowCellStyle = (width: number) => ({ flex: `1 1 ${width}px`, minWidth: `min(${width}px, 100%)` });

/** Ячейка блока: скругляет её внешний контур блока, по высоте она тянется до самой высокой в ряду. */
export const buttonCard = "flex h-full min-h-11 w-full min-w-0 items-center justify-between gap-2 bg-surface-recessed-solid px-3 text-left";

/** Подпись, добавка второй строкой и значение ячейки: тусклое по умолчанию, контрастное — выбранное владельцем. */
export function CardText({ label, meta, bright, children }: { label: ReactNode; meta?: ReactNode; bright: boolean; children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col py-1.5 leading-tight">
      <span className="break-words text-[11px] text-muted-foreground">{label}</span>
      {meta ? <span className="break-words text-[11px] text-muted-foreground">{meta}</span> : null}
      <span data-cell-value className={cn("min-w-0 truncate text-[13px] font-medium", bright ? "text-foreground" : "text-muted-foreground")}>
        {children}
      </span>
    </span>
  );
}

/**
 * Имя документа — своя ссылка поверх кнопки ячейки: клик по имени открывает документ и не трогает ячейку.
 * Длинное имя файла обрезается многоточием, иконка перехода справа не обрезается.
 */
export function DocumentName({ link, stale = false, roots, className }: { link: { label: string; target: string }; stale?: boolean; roots: FileRoots | null; className?: string }) {
  const classes = cn(
    "relative z-10 inline-flex min-w-0 max-w-full items-center gap-1 self-start text-left hover:text-primary",
    stale && "text-muted-foreground line-through",
    className,
  );
  const content = (
    <>
      <span className="min-w-0 truncate underline underline-offset-2">{link.label}</span>
      <Icon name="ExternalLink" aria-hidden="true" className="size-3 shrink-0" />
    </>
  );
  return /^https?:\/\//.test(link.target) ? (
    <a href={link.target} target="_blank" rel="noreferrer" className={classes}>
      {content}
    </a>
  ) : (
    <ResultAnchor target={link.target} roots={roots} className={classes}>
      {content}
    </ResultAnchor>
  );
}

/**
 * Хост открывает страницу плагина в боковом сплите только по клику с Cmd/Ctrl, а обычный клик уводит на неё
 * основную область. Задача из итога всегда встаёт сбоку: обычный клик гасится и переигрывается кликом с Cmd.
 */
const inSplit = (event: React.MouseEvent<HTMLAnchorElement>) => {
  if (event.metaKey || event.ctrlKey || event.button !== 0) return;
  event.preventDefault();
  event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
};

/** Ссылка на карточку задачи в Tasks+ по ключу или слагу: открывается сбоку и не протухает, когда задача меняет статус. */
export function TaskLink({ address, className, children }: { address: string; className?: string; children: ReactNode }) {
  return (
    <a href={taskRoute(address)} onClick={inSplit} className={className}>
      {children}
    </a>
  );
}
