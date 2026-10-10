// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FRESH, RAIL_CLICK_WINDOW_MS, ownsPath, railStep, type PanelState, type RailMemory } from "./core";

const clickedAt = (at: number): RailMemory => railStep(FRESH, { kind: "rail-click", at, openInSplit: false }).memory;
const route = (memory: RailMemory, owned: boolean, panel: PanelState, at = 100) =>
  railStep(memory, { kind: "route", at, owned, panel });
const collapsedByRail: RailMemory = { ...FRESH, collapsedByRail: true };

describe("ownsPath", () => {
  it("a page of a listed plugin is owned, its root too", () => {
    expect(ownsPath(["flow"], "/plugins/flow/flows")).toBe(true);
    expect(ownsPath(["flow"], "/plugins/flow")).toBe(true);
  });

  it("another plugin, a plugin whose id only starts the same, and a thread are not owned", () => {
    expect(ownsPath(["flow"], "/plugins/tasks-plus/tasks")).toBe(false);
    expect(ownsPath(["flow"], "/plugins/flow-extra/x")).toBe(false);
    expect(ownsPath(["flow"], "/threads/thr_1")).toBe(false);
    expect(ownsPath([], "/plugins/flow/flows")).toBe(false);
  });
});

describe("railStep — arriving from the rail", () => {
  it("a rail click into an owned page collapses the expanded panel and remembers it did", () => {
    expect(route(clickedAt(90), true, "expanded")).toEqual({ memory: collapsedByRail, command: "collapse" });
  });

  it("an owned page reached by a link, not the rail, leaves the panel alone", () => {
    expect(route(FRESH, true, "expanded")).toEqual({ memory: FRESH, command: "none" });
  });

  it("a rail click older than the window does not count", () => {
    expect(route(clickedAt(0), true, "expanded", RAIL_CLICK_WINDOW_MS + 1).command).toBe("none");
    expect(route(clickedAt(0), true, "expanded", RAIL_CLICK_WINDOW_MS).command).toBe("collapse");
  });

  it("a Cmd/Ctrl click opens a split and arms nothing", () => {
    const split = railStep(FRESH, { kind: "rail-click", at: 90, openInSplit: true }).memory;
    expect(route(split, true, "expanded").command).toBe("none");
  });

  it("a panel the owner collapsed by hand is not claimed as collapsed by the rail", () => {
    expect(route(clickedAt(90), true, "collapsed")).toEqual({ memory: FRESH, command: "none" });
  });

  it("moving between two owned pages keeps the panel collapsed — no flash", () => {
    expect(route({ ...collapsedByRail, railClickAt: 90 }, true, "collapsed")).toEqual({
      memory: collapsedByRail,
      command: "none",
    });
  });

  it("a route spends the rail click whatever it decides", () => {
    expect(route(route(clickedAt(90), false, "expanded").memory, true, "expanded").command).toBe("none");
  });
});

describe("railStep — leaving", () => {
  it("leaving to a page not owned reopens the panel the rail collapsed", () => {
    expect(route(collapsedByRail, false, "collapsed")).toEqual({ memory: FRESH, command: "expand" });
  });

  it("leaving with the panel already open does nothing and forgets", () => {
    expect(route(collapsedByRail, false, "expanded")).toEqual({ memory: FRESH, command: "none" });
  });

  it("a panel collapsed by hand stays collapsed on leaving", () => {
    expect(route(FRESH, false, "collapsed")).toEqual({ memory: FRESH, command: "none" });
  });

  it("toggling the panel by hand drops the claim, so leaving later reopens nothing", () => {
    const toggled = railStep(collapsedByRail, { kind: "manual-toggle" }).memory;
    expect(route(toggled, false, "collapsed").command).toBe("none");
  });
});

describe("railStep — no panel to drive", () => {
  it("on a phone layout nothing happens and the claim survives", () => {
    expect(route({ ...collapsedByRail, railClickAt: 90 }, true, "unavailable")).toEqual({
      memory: collapsedByRail,
      command: "none",
    });
    expect(route(collapsedByRail, false, "unavailable")).toEqual({ memory: collapsedByRail, command: "none" });
  });
});
