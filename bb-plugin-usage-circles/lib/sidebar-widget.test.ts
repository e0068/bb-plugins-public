// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSidebarUsageCircles } from "./sidebar-widget";

// The re-attach cadence in sidebar-widget.ts (MOUNT_RETRY_MS). Kept in sync by
// hand: these tests assert the widget recovers on that beat, not on the 60s
// data poll.
const MOUNT_RETRY_MS = 2_000;

/** A fresh sidebar footer + menu, replacing whatever was in the body — the
 * shape footerMenu() looks for, and the shape the host re-creates on a
 * settings save. Returns the menu the widget should mount into. */
function buildFooter(): HTMLElement {
  document.body.innerHTML = "";
  const footer = document.createElement("div");
  footer.setAttribute("data-sidebar", "footer");
  const menu = document.createElement("ul");
  menu.setAttribute("data-sidebar", "menu");
  footer.append(menu);
  document.body.append(footer);
  return menu;
}

function widgetIn(menu: HTMLElement): Element | null {
  return menu.querySelector(".usage-circles");
}

/** Stub fetch with a well-formed ok RPC envelope so render() builds the real
 * ring strip (the empty-state path skips it). */
function stubOkState(openOnHover: boolean): void {
  const state = {
    toggles: { fiveHour: true, weekly: true, fable: true },
    openOnHover,
    usage: {
      status: "ok",
      windows: [{ label: "Current session", usedPercent: 41, resetsAt: null }],
    },
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: state }) })));
}

function toggleButton(): HTMLElement | null {
  return document.querySelector(".usage-circles__toggle");
}

function hoverPanel(): HTMLElement | null {
  return document.querySelector(".usage-circles__panel");
}

describe("mountSidebarUsageCircles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // fetchState swallows a non-ok response and returns null, so the widget
    // mounts with no data — enough to assert on the row's presence without
    // stubbing the whole RPC envelope.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("mounts into the footer menu on start", () => {
    const menu = buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    expect(widgetIn(menu)).not.toBeNull();
    controller.abort();
  });

  it("re-attaches within the retry beat after the host swaps the footer node", async () => {
    buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);

    // The host re-renders the sidebar (as a settings save does): the old
    // footer node — with our row inside it — is thrown away for a fresh one.
    const newMenu = buildFooter();
    expect(widgetIn(newMenu)).toBeNull();

    // Recovered on the mount beat alone — no 60s data poll needed.
    await vi.advanceTimersByTimeAsync(MOUNT_RETRY_MS);
    expect(widgetIn(newMenu)).not.toBeNull();

    controller.abort();
  });

  it("stops re-attaching after abort — no zombie widget", async () => {
    const menu = buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    expect(widgetIn(menu)).not.toBeNull();

    controller.abort();
    expect(widgetIn(menu)).toBeNull();

    buildFooter();
    await vi.advanceTimersByTimeAsync(5 * MOUNT_RETRY_MS);
    expect(document.querySelector(".usage-circles")).toBeNull();
  });

  it("hugs the right edge of the horizontal footer row: appended last, with an auto inline-start margin", async () => {
    stubOkState(true);
    const menu = buildFooter();
    // BB's own footer controls (Settings, etc.) already sit in the menu as a
    // horizontal row; the rings must land to the right of them.
    const existing = document.createElement("li");
    existing.setAttribute("data-sidebar", "menu-item");
    menu.append(existing);

    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);

    await vi.advanceTimersByTimeAsync(0); // flush the initial data fetch → render

    const widget = widgetIn(menu) as HTMLElement | null;
    // Right-alignment in a flex row comes from the <li> itself: appended after
    // the existing controls, and pushed to the far edge by an auto left margin.
    // (The inner strip's justify-content is irrelevant — the <li> is
    // content-width, so a `flex-end` on it would right-align against nothing.)
    expect(widget).not.toBeNull();
    expect(menu.lastElementChild).toBe(widget);
    expect(widget?.style.marginLeft).toBe("auto");

    controller.abort();
  });

  it("opens the panel on hover and closes it after leaving, when openOnHover is on", async () => {
    stubOkState(true);
    buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    expect(hoverPanel()).toBeNull();
    toggleButton()?.dispatchEvent(new Event("mouseenter"));
    expect(hoverPanel()).not.toBeNull();

    toggleButton()?.dispatchEvent(new Event("mouseleave"));
    expect(hoverPanel()).not.toBeNull(); // grace period keeps it open briefly
    await vi.advanceTimersByTimeAsync(200);
    expect(hoverPanel()).toBeNull();

    controller.abort();
  });

  it("does not open on hover when openOnHover is off", async () => {
    stubOkState(false);
    buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    toggleButton()?.dispatchEvent(new Event("mouseenter"));
    expect(hoverPanel()).toBeNull();

    controller.abort();
  });
});
