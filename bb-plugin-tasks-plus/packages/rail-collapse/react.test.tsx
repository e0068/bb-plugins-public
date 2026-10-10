// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserEnv } from "./dom";
import { registerRailCollapse, registerSelectedThread, useFollowSelectedThread, type ThreadPage } from "./react";
import { followSelectedThread, selectionOf } from "./selection-dom";
import { RAIL_COLLAPSE_SETTING, SELECTED_THREAD_SETTING } from "./setting";

function mountShell(): HTMLElement {
  document.body.innerHTML = `
    <div data-state="expanded" data-variant="sidebar" data-side="left">
      <span data-nav-rail-item="flows"><button id="flow-icon">Flow</button></span>
    </div>
    <button data-sidebar="trigger" id="trigger"></button>`;
  const root = document.querySelector<HTMLElement>("[data-side='left']")!;
  document.getElementById("trigger")!.addEventListener("click", () => {
    root.dataset.state = root.dataset.state === "expanded" ? "collapsed" : "expanded";
  });
  return root;
}

/** The overlay component registerRailCollapse hands to the host. */
function overlayFor(enabled: () => boolean | undefined): ComponentType {
  let component: ComponentType | null = null;
  const app = { slots: { experimental_appOverlay: (r: { component: ComponentType }) => void (component = r.component) } };
  registerRailCollapse(app, "flow", () => {
    const value = enabled();
    return { values: value === undefined ? undefined : { [RAIL_COLLAPSE_SETTING]: value } };
  });
  return component!;
}

/** jsdom has no Navigation API, so the hub polls the path: step the clock past one poll. */
function visit(path: string): void {
  window.history.pushState(null, "", path);
  act(() => void vi.advanceTimersByTime(250));
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.pushState(null, "", "/threads/thr_1");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("registerRailCollapse", () => {
  it("with the setting on, the rail click collapses the panel", () => {
    const root = mountShell();
    const Overlay = overlayFor(() => true);
    render(<Overlay />);
    document.getElementById("flow-icon")!.click();
    visit("/plugins/flow/flows");
    expect(root.dataset.state).toBe("collapsed");
  });

  it("with the setting off or still loading, the panel stays open", () => {
    for (const value of [false, undefined]) {
      const root = mountShell();
      const Overlay = overlayFor(() => value);
      render(<Overlay />);
      document.getElementById("flow-icon")!.click();
      visit("/plugins/flow/flows");
      expect(root.dataset.state).toBe("expanded");
      cleanup();
      window.history.pushState(null, "", "/threads/thr_1");
    }
  });

  it("turning the setting off stops collapsing", () => {
    const root = mountShell();
    let on = true;
    const Overlay = overlayFor(() => on);
    const view = render(<Overlay />);
    on = false;
    view.rerender(<Overlay />);
    document.getElementById("flow-icon")!.click();
    visit("/plugins/flow/flows");
    expect(root.dataset.state).toBe("expanded");
  });

  it("an SDK without app overlays registers nothing and does not throw", () => {
    expect(() => registerRailCollapse({ slots: {} }, "flow", () => ({ values: undefined }))).not.toThrow();
  });
});

describe("selected thread", () => {
  const SELECTION_KEY = Symbol.for("bb-plugins.selected-thread.v1");
  const settingsWith = (enabled: boolean) => () => ({ values: { [SELECTED_THREAD_SETTING]: enabled } });
  let leaveFollow: () => void = () => undefined;

  beforeEach(() => window.history.pushState(null, "", "/threads/thr_1"));
  afterEach(() => {
    leaveFollow();
    leaveFollow = () => undefined;
    delete (window as unknown as Record<symbol, unknown>)[SELECTION_KEY];
  });

  /** Flow follows the selection; the owner came from thread thr_1 to Flow's page. */
  function arriveOnFlow(): void {
    leaveFollow = followSelectedThread("flow", browserEnv(window));
    visit("/plugins/flow/flows");
  }

  /** A row of bb's threads panel beside the rendered page, clicked plainly. */
  function pickRow(threadId: string): void {
    const row = document.createElement("a");
    row.dataset.sidebarThreadId = threadId;
    document.body.append(row);
    act(() => row.click());
    row.remove();
  }

  function deferred() {
    let settle: (go: (() => void) | null) => void = () => undefined;
    const promise = new Promise<(() => void) | null>((resolve) => (settle = resolve));
    return { promise, settle };
  }

  function Page({ enabled, atRoot, page }: { enabled: boolean; atRoot: boolean; page: ThreadPage }) {
    useFollowSelectedThread(settingsWith(enabled), atRoot, page);
    return null;
  }

  describe("registerSelectedThread", () => {
    function overlay(enabled: boolean): ComponentType {
      let component: ComponentType | null = null;
      const app = { slots: { experimental_appOverlay: (r: { component: ComponentType }) => void (component = r.component) } };
      registerSelectedThread(app, "flow", settingsWith(enabled));
      return component!;
    }

    it("with the setting on, the thread bb shows becomes the selected one", () => {
      const Overlay = overlay(true);
      render(<Overlay />);
      expect(selectionOf(window).threadId).toBe("thr_1");
    });

    it("with the setting off, nothing is selected", () => {
      const Overlay = overlay(false);
      render(<Overlay />);
      expect(selectionOf(window).threadId).toBeNull();
    });
  });

  describe("useFollowSelectedThread", () => {
    it("a page entered at its root goes to the selected thread's item, then to each pick's", async () => {
      arriveOnFlow();
      const went: string[] = [];
      const resolve = vi.fn(async (threadId: string) => () => void went.push(threadId));
      render(<Page enabled atRoot page={{ resolve, openThread: vi.fn() }} />);
      await act(async () => undefined);
      pickRow("thr_2");
      await act(async () => undefined);
      expect(went).toEqual(["thr_1", "thr_2"]);
    });

    it("a picked thread without an item opens the thread itself; an entry without one stays", async () => {
      arriveOnFlow();
      const openThread = vi.fn();
      render(<Page enabled atRoot page={{ resolve: async () => null, openThread }} />);
      await act(async () => undefined);
      expect(openThread).not.toHaveBeenCalled();
      pickRow("thr_2");
      await act(async () => undefined);
      expect(openThread.mock.calls).toEqual([["thr_2"]]);
    });

    it("a failed lookup for a pick opens the thread too", async () => {
      arriveOnFlow();
      const openThread = vi.fn();
      render(<Page enabled atRoot={false} page={{ resolve: async () => Promise.reject(new Error("down")), openThread }} />);
      pickRow("thr_2");
      await act(async () => undefined);
      expect(openThread.mock.calls).toEqual([["thr_2"]]);
    });

    it("only the latest pick's answer moves the page, whatever order the answers come in", async () => {
      arriveOnFlow();
      const answers = new Map([["thr_2", deferred()], ["thr_3", deferred()]]);
      const went: string[] = [];
      render(<Page enabled atRoot={false} page={{ resolve: (threadId) => answers.get(threadId)!.promise, openThread: vi.fn() }} />);
      pickRow("thr_2");
      pickRow("thr_3");
      await act(async () => answers.get("thr_3")!.settle(() => void went.push("thr_3")));
      await act(async () => answers.get("thr_2")!.settle(() => void went.push("thr_2")));
      expect(went).toEqual(["thr_3"]);
    });

    it("an answer that lands after the page closed moves nothing", async () => {
      arriveOnFlow();
      const answer = deferred();
      const go = vi.fn();
      const view = render(<Page enabled atRoot page={{ resolve: () => answer.promise, openThread: vi.fn() }} />);
      view.unmount();
      await act(async () => answer.settle(go));
      expect(go).not.toHaveBeenCalled();
    });

    it("React's development double mount still goes to the entry's item", async () => {
      arriveOnFlow();
      const went: string[] = [];
      const resolve = async (threadId: string) => () => void went.push(threadId);
      render(
        <StrictMode>
          <Page enabled atRoot page={{ resolve, openThread: vi.fn() }} />
        </StrictMode>,
      );
      await act(async () => undefined);
      expect(went).toEqual(["thr_1"]);
    });

    it("settings that load after the page opened still count the entry at the root", async () => {
      arriveOnFlow();
      const resolve = vi.fn(async () => null);
      const page = { resolve, openThread: vi.fn() };
      const view = render(<Page enabled={false} atRoot page={page} />);
      view.rerender(<Page enabled atRoot={false} page={page} />);
      await act(async () => undefined);
      expect(resolve.mock.calls).toEqual([["thr_1"]]);
    });

    it("a deep link, or the setting off, never asks", async () => {
      arriveOnFlow();
      const resolve = vi.fn(async () => null);
      render(<Page enabled atRoot={false} page={{ resolve, openThread: vi.fn() }} />);
      render(<Page enabled={false} atRoot page={{ resolve, openThread: vi.fn() }} />);
      await act(async () => undefined);
      expect(resolve).not.toHaveBeenCalled();
    });
  });
});

describe("browserEnv", () => {
  it("follows the Navigation API where the browser has one", () => {
    const navigation = new EventTarget();
    const fakeWindow = Object.assign(Object.create(window), { navigation }) as Window;
    const listener = vi.fn();
    const stop = browserEnv(fakeWindow).onRouteChange(listener);
    navigation.dispatchEvent(new Event("currententrychange"));
    stop();
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("without it, polls the path and reports only a change", () => {
    const listener = vi.fn();
    const stop = browserEnv(window).onRouteChange(listener);
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
    window.history.pushState(null, "", "/plugins/flow/flows");
    vi.advanceTimersByTime(250);
    stop();
    window.history.pushState(null, "", "/threads/thr_2");
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("measures time on the page's clock", () => {
    expect(typeof browserEnv(window).now()).toBe("number");
  });
});
