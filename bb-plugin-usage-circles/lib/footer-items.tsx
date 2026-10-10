// Layer 3 — the footer items. Each limit window is its own item in BB's
// sidebar footer: the icon is the window's live ring with the provider's logo
// in its middle or its top right corner, the window is the provider's limits
// with the item's own limit marked. BB renders icons outside any plugin
// context, so the usage and the ring style reach them through module stores
// the app's overlay and settings section publish to, not through a hook.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ComponentType, type CSSProperties } from "react";
import { dismissFooterWindow, FooterWindow } from "@bb-plugins/footer-window";
import { buildAllLimits, buildProviderDetails, buildProviderLogo, buildRingIcon, HEADER_LOGO_PX } from "./render";
import { DEFAULT_RING_STYLE, type RingDims, type RingStyle } from "./ring-style";
import {
  buildUsageWindowModel,
  DEFAULT_COLORING,
  FOOTER_RINGS,
  gridLimits,
  providersWithoutData,
  ringWindow,
  shownLimits,
  unclaimedWindows,
  type FooterRing,
  type Layout,
  type LimitsChoice,
  type ProviderStateWire,
  type StateWire,
  type UsageWindowInput,
  type WindowKind,
} from "./usage-model";

export const PLUGIN_ID = "usage-circles";
/** The footer item of every limit: the grid behind one ring, wherever Customize footer puts it; the All limits layout leaves it alone in the footer. */
export const ALL_LIMITS_ITEM = { id: "usage-limits", label: "Usage Limits" } as const;

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
export const useUsage = usageStore.use;

/** Change the last answer by hand, so the windows follow a setting at once, before the backend answers with it. */
function amendUsage(patch: Partial<StateWire>): void {
  const state = usageStore.get();
  if (state !== null) usageStore.publish({ ...state, ...patch });
}

export const publishLimits = (limits: LimitsChoice): void => amendUsage({ limits });
export const publishLayout = (layout: Layout): void => amendUsage({ layout });

/** The ring of the first chosen limit with data. */
const firstShownRing = (state: StateWire | null): FooterRing => (state && shownLimits(state.providers, state.limits)[0]?.ring) ?? FOOTER_RINGS[0]!;

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

type LogoOf = (provider: ProviderStateWire, style: RingStyle) => HTMLElement[];

const providerLogo: LogoOf = (provider, style) => [style.logo === "center" ? centerLogo(provider, style.dims) : cornerBadge(provider, style.dims)];

/** The icon of one ring's footer item: the ring with its provider's logo. */
export const ringIcon = (ring: FooterRing): ComponentType<{ className?: string }> => ringIconOf(() => ring, providerLogo, ring.id);

/** The icon of the item of every limit: the ring of the first chosen limit, with no logo — the item stands for both providers. */
export const allLimitsIcon = (): ComponentType<{ className?: string }> => ringIconOf(firstShownRing, () => [], ALL_LIMITS_ITEM.id);

function ringIconOf(pick: (state: StateWire | null) => FooterRing, logoOf: LogoOf, name: string): ComponentType<{ className?: string }> {
  function RingIcon({ className }: { className?: string }) {
    const state = useUsage();
    const ring = pick(state);
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
      root.current?.replaceChildren(svg, ...(provider ? logoOf(provider, style) : []));
    }, [state, provider, limit, style]);
    return <span ref={root} className={className} style={ICON_STYLE} aria-hidden />;
  }
  RingIcon.displayName = `RingIcon(${name})`;
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

/** The provider with its chosen limits in the chosen order, then the limits no ring stands for. */
function chosenWindows(state: StateWire, provider: ProviderStateWire): ProviderStateWire {
  if (provider.usage.status !== "ok") return provider;
  const windows = [...shownLimits([provider], state.limits).map(({ window }) => window), ...unclaimedWindows(provider)];
  return { ...provider, usage: { status: "ok", windows } };
}

/** The grid under Usage Limits: every chosen limit of both providers as a card, `marked` — the limit of the ring opened — standing out. */
function GridWindow({ state, marked }: { state: StateWire | null; marked?: (state: StateWire) => UsageWindowInput | undefined }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!state) return void root.current?.replaceChildren();
    const { providers, limits, coloring } = state;
    root.current?.replaceChildren(buildAllLimits(gridLimits(providers, limits), coloring, Date.now(), marked?.(state), providersWithoutData(providers)));
  }, [state]);
  return (
    <FooterWindow title={ALL_LIMITS_ITEM.label}>
      <div ref={root} />
    </FooterWindow>
  );
}

/** The provider's limits a row each under its logo and "<provider> Limits"; `title` heads it until the usage arrives. */
function ListWindow({ state, providerId, kind, title }: { state: StateWire | null; providerId: string; kind: WindowKind; title: string }) {
  const root = useRef<HTMLDivElement>(null);
  const provider = state?.providers.find(({ id }) => id === providerId);
  useLayoutEffect(() => {
    if (!state || !provider) return void root.current?.replaceChildren();
    root.current?.replaceChildren(buildProviderDetails(chosenWindows(state, provider), state.coloring, Date.now(), ringWindow(provider, kind)));
  }, [state, provider]);
  return (
    <FooterWindow icon={provider ? <HeaderLogo provider={provider} /> : undefined} title={provider ? `${provider.title} Limits` : title}>
      <div ref={root} />
    </FooterWindow>
  );
}

/**
 * The window of a ring's footer item, the ring's own limit marked: in the List
 * layout the provider's limits a row each; in the Grid layout the grid of both providers.
 */
export function providerPanel(providerId: string, kind: WindowKind, title = providerId): ComponentType<{ dismiss(): void }> {
  const marked = (state: StateWire) => {
    const provider = state.providers.find(({ id }) => id === providerId);
    return provider && ringWindow(provider, kind);
  };
  function ProviderPanel() {
    const state = useUsage();
    return state?.layout === "grid" ? <GridWindow state={state} marked={marked} /> : <ListWindow state={state} providerId={providerId} kind={kind} title={title} />;
  }
  ProviderPanel.displayName = `ProviderPanel(${providerId}:${kind})`;
  return ProviderPanel;
}

/** The window of the item of every limit: the grid, nothing marked. */
export function allLimitsPanel(): ComponentType<{ dismiss(): void }> {
  function AllLimitsPanel() {
    return <GridWindow state={useUsage()} />;
  }
  return AllLimitsPanel;
}

/** The rings the footer does not show: all five in the All limits layout, else the ones of the limits switched off. The item of every limit is never hidden. */
const hiddenItems = (layout: Layout, limits: LimitsChoice): string[] =>
  layout === "all" ? FOOTER_RINGS.map(({ id }) => id) : limits.filter(({ shown }) => !shown).map(({ id }) => id);

/**
 * BB registers footer items once, so the layout hides the ones it does not use:
 * BB wraps every item in an element keyed `plugin:<plugin>/<item>`, hidden whole, with no gap left.
 * A window of a hidden item closes and forgets its pin, so it does not come back with no item under it.
 */
export function FooterPlacement({ layout, limits }: { layout: Layout; limits: LimitsChoice }) {
  const hidden = hiddenItems(layout, limits);
  const key = hidden.join(",");
  useEffect(() => hidden.forEach((itemId) => dismissFooterWindow({ pluginId: PLUGIN_ID, itemId })), [key]);
  if (hidden.length === 0) return null;
  return <style>{`${hidden.map((id) => `[data-footer-item="plugin:${PLUGIN_ID}/${id}"]`).join(",")}{display:none!important}`}</style>;
}
