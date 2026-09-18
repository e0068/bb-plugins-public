// Части ячеек нижнего блока брифа: подпись добавки, чекбокс, текст ячейки и
// ссылка документа. Ими собраны и кнопки брифа прежнего вида, и кнопки этапов.
import type { ReactNode } from "react";

import { addParts, riskText } from "../core/budget";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import { useLocale } from "./locale-context";
import type { Add } from "../shared/contract";

/** Открывает результат по его адресу; `null` — открыть нечем. */
export type OpenFile = ((target: string) => void) | null;

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
 * Имя документа — своя кнопка перехода поверх кнопки ячейки: клик по имени открывает документ и не трогает ячейку.
 * Длинное имя файла обрезается многоточием, иконка перехода справа не обрезается.
 */
export function DocumentName({ link, stale = false, openFile, className }: { link: { label: string; target: string }; stale?: boolean; openFile: OpenFile; className?: string }) {
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
    <button type="button" disabled={openFile === null} onClick={() => openFile?.(link.target)} className={classes}>
      {content}
    </button>
  );
}
