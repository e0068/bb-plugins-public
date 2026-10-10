// What to do with bb's threads panel when the route changes: collapse it when
// the owner came from the left rail to a plugin that asked for it, open it
// again when they leave — unless they toggled it by hand meanwhile.

/** The desktop threads panel; "unavailable" on a phone layout, where it is a drawer. */
export type PanelState = "expanded" | "collapsed" | "unavailable";

export interface RailMemory {
  /** The panel is collapsed because a rail click did it — leaving may reopen it. */
  readonly collapsedByRail: boolean;
  /** When the last plain click on a rail item landed; spent by the next route — then never. */
  readonly railClickAt: number;
}

/** No rail click pending: any route is far outside the window. */
const NO_CLICK = Number.NEGATIVE_INFINITY;

export const FRESH: RailMemory = { collapsedByRail: false, railClickAt: NO_CLICK };

/**
 * A route this long after a rail click still counts as reached from the rail.
 * bb navigates in the click handler itself; the margin covers the shell's
 * 200 ms path polling where the browser lacks the Navigation API.
 */
export const RAIL_CLICK_WINDOW_MS = 400;

export type RailEvent =
  | { readonly kind: "rail-click"; readonly at: number; readonly openInSplit: boolean }
  | { readonly kind: "route"; readonly at: number; readonly owned: boolean; readonly panel: PanelState }
  | { readonly kind: "manual-toggle" };

export type PanelCommand = "collapse" | "expand" | "none";

export interface RailStep {
  readonly memory: RailMemory;
  readonly command: PanelCommand;
}

/** The path is a page of one of the plugins: `/plugins/<id>` or anything under it. */
export const ownsPath = (pluginIds: readonly string[], pathname: string): boolean =>
  pluginIds.some((id) => pathname === `/plugins/${id}` || pathname.startsWith(`/plugins/${id}/`));

const arrive = (collapsedByRail: boolean, fromRail: boolean, panel: PanelState): RailStep =>
  fromRail && panel === "expanded"
    ? { memory: { collapsedByRail: true, railClickAt: NO_CLICK }, command: "collapse" }
    : { memory: { collapsedByRail, railClickAt: NO_CLICK }, command: "none" };

const leave = (collapsedByRail: boolean, panel: PanelState): RailStep => {
  switch (panel) {
    case "unavailable":
      return { memory: { collapsedByRail, railClickAt: NO_CLICK }, command: "none" };
    case "collapsed":
      return { memory: FRESH, command: collapsedByRail ? "expand" : "none" };
    case "expanded":
      return { memory: FRESH, command: "none" };
  }
};

export function railStep(memory: RailMemory, event: RailEvent): RailStep {
  switch (event.kind) {
    case "rail-click":
      return { memory: { ...memory, railClickAt: event.openInSplit ? NO_CLICK : event.at }, command: "none" };
    case "manual-toggle":
      return { memory: { ...memory, collapsedByRail: false }, command: "none" };
    case "route": {
      const fromRail = event.at - memory.railClickAt <= RAIL_CLICK_WINDOW_MS;
      return event.owned
        ? arrive(memory.collapsedByRail, fromRail, event.panel)
        : leave(memory.collapsedByRail, event.panel);
    }
  }
}
