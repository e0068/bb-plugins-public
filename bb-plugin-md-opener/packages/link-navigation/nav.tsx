/**
 * Ярус навигации — react внешний (external в сборке bb), второго инстанса не
 * будет. Поверх чистых слоёв resolve.ts и jump-stack.ts: хук стека прыжков и
 * фабрика linkResolver для md-editor.
 */
import { useCallback, useState } from "react";
import {
  canGoBack,
  current,
  goBack,
  initStack,
  jumpTo,
  type JumpState,
} from "./jump-stack";
import { isInTabLink, parseHref, resolveRelative } from "./resolve";

export function useJumpStack(first: string): {
  current: string | null;
  canBack: boolean;
  jumpTo(abs: string): void;
  back(): void;
  stack: string[];
} {
  const [state, setState] = useState<JumpState>(() => initStack(first));

  const jump = useCallback((abs: string) => {
    setState((s) => jumpTo(s, abs));
  }, []);

  const back = useCallback(() => {
    setState((s) => goBack(s));
  }, []);

  return {
    current: current(state),
    canBack: canGoBack(state),
    jumpTo: jump,
    back,
    stack: state.stack,
  };
}

// Строит linkResolver для md-editor: href, который ведёт локально
// (isInTabLink) и (если задан isLive) живой — кликабелен и прыгает через
// onNavigate на абсолютный путь, резолвнутый относительно fromPath. Иначе —
// null (ссылка рендерится некликабельным текстом).
export function makeLinkResolver(opts: {
  fromPath: string;
  onNavigate: (abs: string) => void;
  isLive?: (abs: string) => boolean;
  labelFor?: (abs: string) => string | undefined;
}): (href: string) => { label?: string; onClick: () => void } | null {
  return (href: string) => {
    if (!isInTabLink(href)) return null;
    const { path } = parseHref(href);
    const abs = resolveRelative(opts.fromPath, path);
    if (opts.isLive && !opts.isLive(abs)) return null;
    return {
      label: opts.labelFor?.(abs),
      onClick: () => opts.onNavigate(abs),
    };
  };
}
