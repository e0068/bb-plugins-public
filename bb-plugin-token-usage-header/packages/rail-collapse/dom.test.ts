// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { joinRailCollapse, type RailEnv } from "./dom";

// The pieces of bb's shell the hub reads: the desktop sidebar root carrying
// data-state, the title-bar trigger that toggles it, and rail items.
function mountShell(state: "expanded" | "collapsed"): HTMLElement {
  document.body.innerHTML = `
    <div class="group peer" data-state="${state}" data-collapsible="" data-variant="sidebar" data-side="left">
      <nav>
        <span data-nav-rail-item="flows"><button id="flow-icon">Flow</button></span>
        <span data-nav-rail-item="new-thread"><button id="new-icon">New thread</button></span>
      </nav>
    </div>
    <button data-sidebar="trigger" id="trigger"><span>Toggle Sidebar</span></button>`;
  const root = document.querySelector<HTMLElement>("[data-side='left']")!;
  document.getElementById("trigger")!.addEventListener("click", () => {
    root.dataset.state = root.dataset.state === "expanded" ? "collapsed" : "expanded";
  });
  return root;
}

let now = 0;
let routeListeners: Array<() => void> = [];
const env: RailEnv = {
  window,
  now: () => now,
  onRouteChange: (listener) => {
    routeListeners.push(listener);
    return () => {
      routeListeners = routeListeners.filter((l) => l !== listener);
    };
  },
};

function go(path: string): void {
  window.history.pushState(null, "", path);
  routeListeners.forEach((l) => l());
}

function click(id: string, init: MouseEventInit = {}): void {
  document.getElementById(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, ...init }));
}

/** MutationObserver callbacks run as microtasks: let them land. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const leaves: Array<() => void> = [];
const join = (pluginId: string) => leaves.push(joinRailCollapse(pluginId, env));

beforeEach(() => {
  now = 1000;
  go("/threads/thr_1");
});

afterEach(() => {
  leaves.splice(0).forEach((leave) => leave());
  document.body.innerHTML = "";
});

describe("joinRailCollapse", () => {
  it("a click on the plugin's rail icon collapses the open threads panel", () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("collapsed");
  });

  it("leaving for a thread opens the panel again", () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("collapsed");
    go("/threads/thr_2");
    expect(root.dataset.state).toBe("expanded");
  });

  it("going on to another plugin with the setting keeps the panel collapsed the whole way", () => {
    const root = mountShell("expanded");
    join("flow");
    join("tasks-plus");
    click("flow-icon");
    go("/plugins/flow/flows");
    const seen: string[] = [];
    new MutationObserver(() => seen.push(root.dataset.state!)).observe(root, { attributes: true });
    click("flow-icon");
    go("/plugins/tasks-plus/tasks");
    expect(root.dataset.state).toBe("collapsed");
    expect(seen).toEqual([]);
  });

  it("Cmd/Ctrl-click opens a split and leaves the panel open", () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon", { metaKey: true });
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("expanded");
  });

  it("a page reached by a link, not the rail, leaves the panel open", () => {
    const root = mountShell("expanded");
    join("flow");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("expanded");
  });

  it("a plugin that has not joined is not collapsed for", () => {
    const root = mountShell("expanded");
    join("tasks-plus");
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("expanded");
  });

  it("once every plugin leaves, rail clicks do nothing", () => {
    const root = mountShell("expanded");
    join("flow");
    leaves.splice(0).forEach((leave) => leave());
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("expanded");
  });

  it("a plugin mounted twice stays joined until both leave, and a second leave is a no-op", () => {
    const root = mountShell("expanded");
    const first = joinRailCollapse("flow", env);
    join("flow");
    first();
    first();
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(root.dataset.state).toBe("collapsed");
  });

  it("toggling the panel by hand on the plugin page means leaving does not reopen it", async () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    click("trigger");
    click("trigger");
    await settle();
    expect(root.dataset.state).toBe("collapsed");
    go("/threads/thr_2");
    expect(root.dataset.state).toBe("collapsed");
  });

  it("a toggle without the button — bb's hotkey — also counts as by hand", async () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    root.dataset.state = "expanded";
    root.dataset.state = "collapsed";
    await settle();
    go("/threads/thr_2");
    expect(root.dataset.state).toBe("collapsed");
  });

  it("the hub's own collapse is not mistaken for a hand toggle", async () => {
    const root = mountShell("expanded");
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    await settle();
    go("/threads/thr_2");
    expect(root.dataset.state).toBe("expanded");
  });

  it("without the desktop sidebar (phone layout) nothing is toggled", () => {
    document.body.innerHTML = `<span data-nav-rail-item="flows"><button id="flow-icon">Flow</button></span>
      <button data-sidebar="trigger" id="trigger"></button>`;
    let toggles = 0;
    document.getElementById("trigger")!.addEventListener("click", () => (toggles += 1));
    join("flow");
    click("flow-icon");
    go("/plugins/flow/flows");
    expect(toggles).toBe(0);
  });
});
