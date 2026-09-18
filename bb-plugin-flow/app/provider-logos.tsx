// Логотипы провайдеров во фронте без обращения к SDK: контекст и значок частей.
// Источник, читающий список провайдеров хоста, — в `provider-logos-source.tsx`
// у корней поверхностей. Хост отдаёт логотип одноцветным SVG на currentColor:
// в <img> он чернеет, поэтому логотип — маска поверх цвета текста.
import { createContext, useContext, type CSSProperties } from "react";

import { CLAUDE_CODE_PROVIDER } from "../core/catalog";
import { cssUrl } from "../core/row-glyph-css";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { StageExecutor } from "../shared/contract";

export type ProviderBrand = { name: string; logoUrl: string };

/** Провайдеры с логотипом по id; вне источника — пусто. */
export const ProviderLogosContext = createContext<ReadonlyMap<string, ProviderBrand>>(new Map());

const maskOf = (url: string): CSSProperties => {
  const mask = `${cssUrl(url)} center / contain no-repeat`;
  return { mask, WebkitMask: mask, backgroundColor: "currentColor" };
};

/**
 * Значок исполнителя логотипом его провайдера: `framed` — субагент, логотип вдвое меньше в контурном квадрате.
 * Провайдера нет или у него нет логотипа — `fallback`, прежний значок.
 */
export function ProviderMark({ providerId, framed, fallback, className }: { providerId: string | undefined; framed: boolean; fallback: string; className?: string }) {
  const brand = useContext(ProviderLogosContext).get(providerId ?? "");
  if (brand === undefined) return <Icon name={fallback} aria-hidden="true" className={className} />;
  const own = { role: "img", "aria-label": brand.name, "data-provider-logo": brand.logoUrl };
  return framed ? (
    <span {...own} data-framed="" className={cn("flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-current", className)}>
      <span className="size-[7px]" style={maskOf(brand.logoUrl)} />
    </span>
  ) : (
    <span {...own} className={cn("inline-block shrink-0", className)} style={maskOf(brand.logoUrl)} />
  );
}

/** Значок исполнителя из каталога: workflow — свой, агент — логотип провайдера в квадрате, без логотипа — прежний значок. */
export function ExecutorMark({ executor, className }: { executor: StageExecutor; className?: string }) {
  if (executor.kind === "workflow") return <Icon name="Workflow" aria-hidden="true" className={className} />;
  return <ProviderMark providerId={executor.provider} framed fallback={executor.provider === CLAUDE_CODE_PROVIDER ? "Claude" : "Bot"} className={className} />;
}
