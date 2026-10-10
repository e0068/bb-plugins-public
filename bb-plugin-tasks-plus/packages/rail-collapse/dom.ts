// The shell around core.ts: reads bb's threads panel out of the DOM, toggles it
// with bb's own trigger, listens for rail clicks and route changes. bb gives
// plugins no API for the panel, so these selectors follow bb's markup. One hub
// per window serves every plugin bundle that joined: a navigation is decided
// once, and moving between two joined plugins never flashes the panel.
import { FRESH, ownsPath, railStep, type PanelCommand, type PanelState, type RailEvent, type RailMemory } from "./core";
import { joinCounted } from "./membership";

export interface RailEnv {
  readonly window: Window;
  readonly now: () => number;
  /** Calls the listener after every client-side navigation; returns the unsubscribe. */
  readonly onRouteChange: (listener: () => void) => () => void;
}

/** bb's desktop sidebar root; the phone drawer carries data-sidebar="panel" and is left alone. */
const SIDEBAR_ROOT = 'div[data-side="left"][data-variant="sidebar"][data-state]:not([data-sidebar])';
const TRIGGER = '[data-sidebar="trigger"]';
const RAIL_ITEM = "[data-nav-rail-item]";
const ROUTE_POLL_MS = 200;
const HUB_KEY = Symbol.for("bb-plugins.rail-collapse.v1");

interface Hub {
  /** Joined plugin ids with how many times each joined (a window may mount an overlay twice). */
  readonly owners: Map<string, number>;
  readonly close: () => void;
}

type HubSlot = Record<symbol, Hub | undefined>;

const readPanel = (document: Document): PanelState => {
  const state = document.querySelector<HTMLElement>(SIDEBAR_ROOT)?.dataset.state;
  return (state === "expanded" || state === "collapsed") && document.querySelector(TRIGGER) !== null
    ? state
    : "unavailable";
};

/** The Navigation API where the browser has it, polling the path otherwise. */
function watchRoutes(window: Window, listener: () => void): () => void {
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  if (navigation !== undefined) {
    navigation.addEventListener("currententrychange", listener);
    return () => navigation.removeEventListener("currententrychange", listener);
  }
  let last = window.location.pathname;
  const timer = window.setInterval(() => {
    if (window.location.pathname === last) return;
    last = window.location.pathname;
    listener();
  }, ROUTE_POLL_MS);
  return () => window.clearInterval(timer);
}

export const browserEnv = (window: Window): RailEnv => ({
  window,
  now: () => window.performance.now(),
  onRouteChange: (listener) => watchRoutes(window, listener),
});

function openHub(env: RailEnv): Hub {
  const { document } = env.window;
  const owners = new Map<string, number>();
  let memory: RailMemory = FRESH;
  // The hub's own toggles whose data-state change has not been observed yet;
  // every other change of the panel — the button, bb's hotkey — is the owner's.
  let ownTogglesInFlight = 0;

  const drive = (command: PanelCommand): void => {
    const trigger = document.querySelector<HTMLElement>(TRIGGER);
    if (command === "none" || trigger === null) return;
    ownTogglesInFlight += 1;
    trigger.click();
  };

  const apply = (event: RailEvent): void => {
    const step = railStep(memory, event);
    memory = step.memory;
    drive(step.command);
  };

  const onPanelChanges = (records: readonly MutationRecord[]): void =>
    records
      .filter((record) => record.target instanceof Element && record.target.matches(SIDEBAR_ROOT))
      .forEach(() => {
        if (ownTogglesInFlight > 0) ownTogglesInFlight -= 1;
        else apply({ kind: "manual-toggle" });
      });

  const onClick = (event: MouseEvent): void => {
    const item = event.target instanceof Element ? event.target.closest(RAIL_ITEM) : null;
    if (item !== null && event.button === 0) {
      apply({ kind: "rail-click", at: env.now(), openInSplit: event.metaKey || event.ctrlKey });
    }
  };

  const onRoute = (): void =>
    apply({
      kind: "route",
      at: env.now(),
      owned: ownsPath([...owners.keys()], env.window.location.pathname),
      panel: readPanel(document),
    });

  // Capture: the rail click is recorded before bb's own handler navigates.
  document.addEventListener("click", onClick, true);
  // The whole body, not the sidebar root: bb may remount the root when the layout changes.
  const panelWatch = new MutationObserver(onPanelChanges);
  panelWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
  const stopRoutes = env.onRouteChange(onRoute);
  return {
    owners,
    close: () => {
      document.removeEventListener("click", onClick, true);
      panelWatch.disconnect();
      stopRoutes();
    },
  };
}

/**
 * Collapse the threads panel when the owner reaches this plugin from the left
 * rail, and reopen it when they leave for a page of a plugin that has not
 * joined. Returns the leave function; the hub closes with the last plugin.
 */
export function joinRailCollapse(pluginId: string, env: RailEnv): () => void {
  const slot = env.window as unknown as HubSlot;
  const hub = (slot[HUB_KEY] ??= openHub(env));
  return joinCounted(hub.owners, pluginId, () => {
    hub.close();
    delete slot[HUB_KEY];
  });
}
