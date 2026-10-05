// Layer 3 — the footer items. Each limit window is its own item in BB's
// sidebar footer: the icon is the window's live ring with the provider's logo
// in its middle or its top right corner, the window is the provider's limits
// with the item's own limit marked. BB renders icons outside any plugin
// context, so the usage and the ring style reach them through module stores
// the app's overlay and settings section publish to, not through a hook.
import { useLayoutEffect, useRef, useSyncExternalStore, type ComponentType, type CSSProperties } from "react";
import { FooterWindow } from "@bb-plugins/footer-window";
import { buildProviderDetails, buildProviderLogo, buildRingIcon, HEADER_LOGO_PX } from "./render";
import { DEFAULT_RING_STYLE, type RingDims, type RingStyle } from "./ring-style";
import { buildUsageWindowModel, DEFAULT_COLORING, ringWindow, type FooterRing, type ProviderStateWire, type StateWire, type WindowKind } from "./usage-model";

/** A value every icon and window reads, published from outside React. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return {
    publish(next: T): void {
      value = next;
      listeners.forEach((listener) => listener());
    },
    get: (): T => value,
    use: (): T => useSyncExternalStore(subscribe, () => value, () => value),
  };
}

const usageStore = store<StateWire | null>(null);
const ringStyleStore = store<RingStyle>(DEFAULT_RING_STYLE);

/** Hand the latest `getState` answer to every icon and window; `null` before the first one. */
export const publishUsage = usageStore.publish;
/** Redraw every ring in a new style — from `getState`, or live while a slider moves. */
export const publishRingStyle = ringStyleStore.publish;
export const useRingStyle = ringStyleStore.use;
export const getRingStyle = ringStyleStore.get;
const useUsage = usageStore.use;

const ICON_STYLE: CSSProperties = { position: "relative", display: "inline-flex", width: "100%", height: "100%" };

/**
 * BB puts a plugin icon into a 16 px box at 80% opacity. In the footer row the
 * ring grows that box to the style's size and shows at full opacity;
 * elsewhere — the overflow menu, Customize footer — the box stays BB's.
 * Returns the restoration.
 */
function growIconBox(icon: HTMLElement, sizePx: number): () => void {
  const box = icon.closest<HTMLElement>("[data-icon-root]");
  if (!box?.closest("[data-footer-item]")) return () => undefined;
  const before = { width: box.style.width, height: box.style.height, opacity: box.style.opacity };
  Object.assign(box.style, { width: `${sizePx}px`, height: `${sizePx}px`, opacity: "1" });
  return () => Object.assign(box.style, before);
}

/** A length of the style as a share of the ring's box, so the logo scales with whatever box bb gives the icon. */
const share = (px: number, { size }: RingDims): string => `${(px / size) * 100}%`;

// BB draws the footer outside the plugin root: the logo is styled inline.
function centerLogo(provider: ProviderStateWire, dims: RingDims): HTMLElement {
  const holder = document.createElement("span");
  holder.setAttribute("data-provider-logo-center", "");
  Object.assign(holder.style, {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    display: "flex",
    width: share(dims.centerLogo, dims),
    height: share(dims.centerLogo, dims),
  });
  holder.append(buildProviderLogo(provider, "fill"));
  return holder;
}

/** The corner logo sits on the sidebar's own background so it reads over the ring's edge. */
function cornerBadge(provider: ProviderStateWire, dims: RingDims): HTMLElement {
  const badge = document.createElement("span");
  badge.setAttribute("data-provider-badge", "");
  const side = share(dims.cornerLogo + 2 * dims.cornerPad, dims);
  Object.assign(badge.style, {
    position: "absolute",
    top: share(-dims.cornerTop, dims),
    right: share(-dims.cornerRight, dims),
    boxSizing: "border-box",
    display: "flex",
    width: side,
    height: side,
    padding: share(dims.cornerPad, dims),
    borderRadius: "9999px",
    backgroundColor: "var(--sidebar)",
  });
  badge.append(buildProviderLogo(provider, "fill"));
  return badge;
}

/** The icon of one ring's footer item. */
export function ringIcon(ring: FooterRing): ComponentType<{ className?: string }> {
  function RingIcon({ className }: { className?: string }) {
    const state = useUsage();
    const style = useRingStyle();
    const root = useRef<HTMLSpanElement>(null);
    const provider = state?.providers.find(({ id }) => id === ring.providerId);
    const limit = provider && ringWindow(provider, ring.kind);
    useLayoutEffect(() => (root.current ? growIconBox(root.current, style.dims.size) : undefined), [style.dims.size]);
    useLayoutEffect(() => {
      const coloring = state?.coloring ?? DEFAULT_COLORING;
      const model = buildUsageWindowModel(limit ?? { label: ring.label, usedPercent: 0, resetsAt: null }, Date.now(), coloring);
      const svg = buildRingIcon(model, style);
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      const logo = provider ? [style.logo === "center" ? centerLogo(provider, style.dims) : cornerBadge(provider, style.dims)] : [];
      root.current?.replaceChildren(svg, ...logo);
    }, [state, provider, limit, style]);
    return <span ref={root} className={className} style={ICON_STYLE} aria-hidden />;
  }
  RingIcon.displayName = `RingIcon(${ring.id})`;
  return RingIcon;
}

/** The provider's logo before the window's title. */
function HeaderLogo({ provider }: { provider: ProviderStateWire }) {
  const root = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    root.current?.replaceChildren(buildProviderLogo(provider, HEADER_LOGO_PX));
  }, [provider]);
  return <span ref={root} style={{ display: "inline-flex" }} />;
}

/**
 * The window of a footer item: the shared window's header — the provider's
 * logo and "<provider> Limits", drawn at once — over every limit of the
 * provider, the item's own one marked. `title` heads it until the usage arrives.
 */
export function providerPanel(providerId: string, kind: WindowKind, title = providerId): ComponentType<{ dismiss(): void }> {
  function ProviderPanel() {
    const state = useUsage();
    const root = useRef<HTMLDivElement>(null);
    const provider = state?.providers.find(({ id }) => id === providerId);
    useLayoutEffect(() => {
      root.current?.replaceChildren(...(state && provider ? [buildProviderDetails(provider, state.coloring, Date.now(), ringWindow(provider, kind))] : []));
    }, [state, provider]);
    return (
      <FooterWindow icon={provider ? <HeaderLogo provider={provider} /> : undefined} title={provider ? `${provider.title} Limits` : title}>
        <div ref={root} />
      </FooterWindow>
    );
  }
  ProviderPanel.displayName = `ProviderPanel(${providerId}:${kind})`;
  return ProviderPanel;
}
