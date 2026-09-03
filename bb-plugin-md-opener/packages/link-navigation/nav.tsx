/**
 * The navigation tier — react is external (an external in the bb build), so
 * there won't be a second instance. Built on top of the pure resolve.ts and
 * jump-stack.ts layers: the jump-stack hook and a linkResolver factory for md-editor.
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

// Builds a linkResolver for md-editor: an href that leads locally
// (isInTabLink) and (if isLive is given) is live — clickable, and jumps via
// onNavigate to the absolute path resolved against fromPath. Otherwise —
// null (the link renders as non-clickable text).
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
