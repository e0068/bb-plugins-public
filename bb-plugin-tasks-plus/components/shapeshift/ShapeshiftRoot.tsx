import { useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { ModesRoot } from './ModesRoot';

/**
 * The root every Shapeshift component of Tasks+ is drawn under: the system's modes and tokens, in the theme bb
 * paints in. The theme is read from the host's `color-scheme` — the one signal a themed host has to declare — and
 * from the system preference when the host declares none, as packages/code-editor/use-host-color-mode.ts does.
 * See docs/specs/tasks-plus-vendorennyi-nabor-shapeshift.md, node `shapeshiftRoot`.
 */

export type ShapeshiftTheme = 'Light' | 'Dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme the host declares, or the system's when it declares neither scheme alone. */
export function hostTheme(): ShapeshiftTheme {
  if (typeof document === 'undefined') return 'Light';
  const declared = getComputedStyle(document.documentElement).colorScheme.trim();
  if (declared === 'dark') return 'Dark';
  if (declared === 'light') return 'Light';
  if (document.documentElement.classList.contains('dark')) return 'Dark';
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'Dark' : 'Light';
}

function subscribe(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const media = window.matchMedia?.(DARK_QUERY);
  media?.addEventListener('change', notify);
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(notify);
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  return () => {
    media?.removeEventListener('change', notify);
    observer?.disconnect();
  };
}

export const useHostTheme = (): ShapeshiftTheme => useSyncExternalStore(subscribe, hostTheme, () => 'Light');

export const ShapeshiftRoot = ({ children, className }: { readonly children?: ReactNode; readonly className?: string }): ReactElement => (
  <div className={className}>
    <ModesRoot brand="A" theme={useHostTheme()} language="EN" density="Compact" breakpoint="Desktop">
      {children}
    </ModesRoot>
  </div>
);
