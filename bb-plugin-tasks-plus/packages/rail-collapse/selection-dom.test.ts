// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RailEnv } from "./dom";
import { followSelectedThread, selectionOf, subscribeSelection } from "./selection-dom";

// bb's threads panel: each row is an overlay link carrying the thread id, its
// buttons sit beside it; a section of rows carries the row attribute too.
// bb's own navigation stands in as a click listener on the body, which a
// click taken from bb never reaches.
let bbOpened: string[] = [];
const bbNavigates = (event: MouseEvent) => {
  const row = (event.target as Element).closest<HTMLElement>("[data-sidebar-thread-id]");
  if (row !== null) bbOpened.push(row.dataset.sidebarThreadId!);
};

function mountPanel(): void {
  document.body.innerHTML = `
    <div data-side="left">
      <div data-sidebar-rename-row id="section">
        <div data-sidebar-rename-row id="container-1"><span><a href="/threads/thr_1" data-sidebar-thread-id="thr_1">First</a></span></div>
        <div data-sidebar-rename-row id="container-2"><span><a href="/threads/thr_2" data-sidebar-thread-id="thr_2" id="row-2"><span id="title-2">Second</span></a></span><button id="archive-2">Archive</button></div>
        <div data-sidebar-rename-row><span><a href="/threads/thr_3" data-sidebar-thread-id="thr_3" id="row-3">Third</a></span></div>
      </div>
    </div>`;
}

function click(id: string, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  document.getElementById(id)!.dispatchEvent(event);
  return event;
}

let routeListeners: Array<() => void> = [];
const env: RailEnv = {
  window,
  now: () => 0,
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

/** The rows of bb's threads panel the page marks as selected, by the id of their container. */
function markedRows(): string[] {
  const sheet = document.head.querySelector<HTMLStyleElement>("style[data-bb-selected-thread]")?.sheet;
  const rules = Array.from(sheet?.cssRules ?? []) as CSSStyleRule[];
  return rules.flatMap((rule) => Array.from(document.querySelectorAll(rule.selectorText), (row) => row.id));
}

const leaves: Array<() => void> = [];
const follow = (pluginId: string) => leaves.push(followSelectedThread(pluginId, env));

beforeEach(() => {
  bbOpened = [];
  document.body.addEventListener("click", bbNavigates);
  mountPanel();
  window.history.pushState(null, "", "/threads/thr_1");
});

afterEach(() => {
  leaves.splice(0).forEach((leave) => leave());
  document.body.removeEventListener("click", bbNavigates);
  document.body.innerHTML = "";
  delete (window as unknown as Record<symbol, unknown>)[Symbol.for("bb-plugins.selected-thread.v1")];
});

describe("selected thread", () => {
  it("the thread open when a plugin joins is the selected one, for every plugin bundle in the window", () => {
    follow("flow");
    expect(selectionOf(window)).toEqual({ threadId: "thr_1", picks: 0 });
  });

  it("going to a following plugin's page keeps the thread the owner came from", () => {
    follow("flow");
    go("/plugins/flow/flows");
    expect(selectionOf(window).threadId).toBe("thr_1");
  });

  it("a thread of a project, under its project's address, is selected too", () => {
    follow("flow");
    go("/projects/proj_abc/threads/thr_4");
    go("/plugins/flow/flows");
    expect(selectionOf(window).threadId).toBe("thr_4");
  });

  it("going home or to a plugin that does not follow drops it", () => {
    follow("flow");
    go("/");
    expect(selectionOf(window).threadId).toBeNull();
    go("/threads/thr_2");
    go("/plugins/tasks-plus/tasks");
    expect(selectionOf(window).threadId).toBeNull();
  });

  it("on a following plugin's page a click on a thread row switches the page instead of opening the thread", () => {
    follow("flow");
    go("/plugins/flow/flows");
    const event = click("title-2");
    expect(event.defaultPrevented).toBe(true);
    expect(bbOpened).toEqual([]);
    expect(selectionOf(window)).toEqual({ threadId: "thr_2", picks: 1 });
  });

  it("subscribers hear every change, and stop hearing once they unsubscribe", () => {
    follow("flow");
    go("/plugins/flow/flows");
    const listener = vi.fn();
    const stop = subscribeSelection(window, listener);
    click("row-3");
    stop();
    click("row-2");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("on a page of a plugin that does not follow, the thread opens as usual", () => {
    follow("tasks-plus");
    go("/plugins/flow/flows");
    click("row-2");
    expect(bbOpened).toEqual(["thr_2"]);
  });

  it("on a thread page the click opens the thread as usual", () => {
    follow("flow");
    click("row-2");
    expect(bbOpened).toEqual(["thr_2"]);
  });

  it("Cmd/Ctrl-click and the row's own buttons keep bb's meaning", () => {
    follow("flow");
    go("/plugins/flow/flows");
    click("row-2", { metaKey: true });
    click("archive-2");
    expect(bbOpened).toEqual(["thr_2"]);
    expect(selectionOf(window).picks).toBe(0);
  });

  it("on a following plugin's page the selected thread's row is marked like bb's open thread, and moves with each pick", () => {
    follow("flow");
    go("/plugins/flow/flows");
    expect(markedRows()).toEqual(["container-1"]);
    click("row-2");
    expect(markedRows()).toEqual(["container-2"]);
  });

  it("the mark is bb's own colour for an open thread", () => {
    follow("flow");
    go("/plugins/flow/flows");
    expect(document.head.querySelector("style[data-bb-selected-thread]")!.textContent).toContain("var(--state-active)");
  });

  it("the mark lays the colour over the panel's own fill, so a row stuck to the top stays opaque", () => {
    follow("flow");
    go("/plugins/flow/flows");
    expect(document.head.querySelector("style[data-bb-selected-thread]")!.textContent).toContain("linear-gradient(var(--sidebar), var(--sidebar))");
  });

  it("a thread page, another page, or every follower leaving takes the mark away", () => {
    follow("flow");
    go("/plugins/flow/flows");
    go("/threads/thr_3");
    expect(markedRows()).toEqual([]);
    go("/plugins/flow/flows");
    go("/plugins/tasks-plus/tasks");
    expect(markedRows()).toEqual([]);
    go("/threads/thr_1");
    go("/plugins/flow/flows");
    leaves.splice(0).forEach((leave) => leave());
    expect(document.head.querySelector("style[data-bb-selected-thread]")).toBeNull();
  });

  it("once every follower leaves, thread clicks and routes go by — the selection is kept", () => {
    const first = followSelectedThread("flow", env);
    follow("flow");
    first();
    first();
    go("/plugins/flow/flows");
    click("row-2");
    leaves.splice(0).forEach((leave) => leave());
    click("row-3");
    go("/");
    expect(bbOpened).toEqual(["thr_3"]);
    expect(selectionOf(window)).toEqual({ threadId: "thr_2", picks: 1 });
  });
});
