// @vitest-environment jsdom
//
// What lies under the thread screen while a finger carries it home: bb's
// composer and Threads Overview, standing where they stood on Home. Until a
// gesture starts the section is a skeleton — a picture of where the list will
// be, costing nothing; the moment a finger starts the gesture on a thread, the
// real list is drawn in its place, so Home is seen as it will open. And the
// gesture does not start at all while the composer stands open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

function finger(type: string, x: number, y: number, on: Element = document.body): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
  });
  on.dispatchEvent(event);
}

function stubFinger(): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function thread(id: string, title: string): PluginSidebarThread {
  return {
    id,
    projectId: "p_alpha",
    title,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 1000,
  };
}

const THREADS = {
  sidebarThreads: {
    status: "ready" as const,
    threads: [thread("th_a", "Тред Альфы"), thread("th_b", "Второй тред")],
    projects: [{ id: "p_alpha", name: "Альфа", isPersonal: false }],
  },
  rpc: { listPostponed: () => ({ postponed: [] }) },
};

async function renderOverlay() {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays.find((registration) => registration.id === "home-swipe")!;
  return renderSlot(overlay, {}, { context: { threadId: "th_a" }, ...THREADS });
}

/** bb's own layout root, the whole screen. */
function screen(): HTMLElement {
  const root = document.createElement("div");
  root.dataset.testid = "app-layout-root";
  document.body.append(root);
  return root;
}

/** Draw Home on a narrow screen, with the section standing at `section`. */
function drawHome(root: HTMLElement, section: { top: number; left: number; width: number; height: number }): void {
  root.innerHTML = "";
  const home = document.createElement("div");
  home.dataset.testid = "root-compose-compact-home";
  const box = document.createElement("div");
  box.setAttribute("data-threads-overview-section", "");
  box.getBoundingClientRect = () =>
    ({ ...section, right: section.left + section.width, bottom: section.top + section.height, x: section.left, y: section.top }) as DOMRect;
  home.append(box);
  root.append(home);
}

function drawThread(root: HTMLElement): void {
  root.innerHTML = "";
  root.append(document.createElement("div"));
}

/** bb's composer on the screen, open unless drawn compact. */
function drawComposer(root: HTMLElement, compact: boolean): void {
  const shell = document.createElement("div");
  shell.setAttribute("data-app-composer", "");
  shell.setAttribute("data-app-composer-role", "primary");
  const form = document.createElement("form");
  form.setAttribute("data-promptbox", "");
  if (compact) form.setAttribute("data-promptbox-compact", "");
  shell.append(form);
  root.append(shell);
}

const layer = () => document.querySelector<HTMLElement>("[data-home-swipe-home]")!;
const sectionBox = () => layer().querySelector<HTMLElement>("[data-home-swipe-section]")!;
const skeleton = () => layer().querySelector("[data-home-swipe-skeleton]");

/** Let the section's data arrive. */
const settle = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(() => {
  stubFinger();
  window.innerHeight = 800;
});
afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("Threads Overview under the card", () => {
  it("is a skeleton until a gesture starts, with no thread of the list drawn", async () => {
    await renderOverlay();
    await settle();
    expect(skeleton()).not.toBeNull();
    expect(layer().textContent).not.toContain("Тред Альфы");
  });

  it("stays a skeleton for a touch that starts no gesture", async () => {
    await renderOverlay();
    drawThread(screen());
    await act(async () => finger("touchstart", 200, 300));
    await settle();
    expect(skeleton()).not.toBeNull();
  });

  it("is a skeleton again once the card has settled back into the thread", async () => {
    await renderOverlay();
    drawThread(screen());
    await act(async () => {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 740);
      finger("touchend", 200, 740);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(skeleton()).not.toBeNull();
  });

  it("stands where the section stood on Home when last seen", async () => {
    await renderOverlay();
    const root = screen();
    drawHome(root, { top: 56, left: 8, width: 374, height: 600 });
    await act(async () => {
      finger("touchstart", 200, 300);
      finger("touchend", 200, 300);
    });
    const box = sectionBox();
    expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual([
      "56px",
      "8px",
      "374px",
      "600px",
    ]);
  });

  it("lays nothing over Home: the layer holds the section and the composer, and nothing dims them", async () => {
    await renderOverlay();
    drawThread(screen());
    await act(async () => {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 660);
    });
    const children = Array.from(layer().children) as HTMLElement[];
    expect(children).toHaveLength(2);
    expect(children[0]!.hasAttribute("data-home-swipe-section")).toBe(true);
    expect(children[1]!.querySelector("[data-testid=bb-new-thread-composer]")).not.toBeNull();
    for (const child of children) expect(child.style.opacity).toBe("");
  });
});

describe("Threads Overview under a card that lifts", () => {
  it("is the real list the moment the card lifts off a thread", async () => {
    await renderOverlay();
    drawThread(screen());
    await act(async () => {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 740);
    });
    await settle();
    expect(skeleton()).toBeNull();
    expect(layer().textContent).toContain("Тред Альфы");
  });

  it("stays a skeleton after a tap on the strip, where the thread's composer sits", async () => {
    await renderOverlay();
    drawThread(screen());
    await act(async () => {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 777);
      finger("touchend", 200, 777);
    });
    await settle();
    expect(skeleton()).not.toBeNull();
    expect(layer().textContent).not.toContain("Тред Альфы");
  });

  it("keeps the real list over the screen while Home is handed over, and is a skeleton once Home has taken it", async () => {
    await renderOverlay();
    const root = screen();
    drawThread(root);
    await act(async () => {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 660);
      finger("touchend", 200, 660);
    });
    await settle();
    expect(layer().textContent).toContain("Тред Альфы");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1300));
    });
    expect(skeleton()).not.toBeNull();
  });

  it("stands edge to edge in the box the section had on Home, with no inset of its own", async () => {
    await renderOverlay();
    const root = screen();
    drawHome(root, { top: 56, left: 8, width: 374, height: 600 });
    await act(async () => {
      finger("touchstart", 200, 300);
      finger("touchend", 200, 300);
    });
    expect(sectionBox().style.paddingInline).toBe("");
    expect(sectionBox().className).not.toMatch(/\bpx-/);
  });
});

describe("the card over Home", () => {
  /** The shadows in a CSS `box-shadow` that spread past the card: a spread shadow veils the whole screen around it. */
  function spreadShadows(boxShadow: string): string[] {
    return boxShadow
      .split(/,(?![^(]*\))/)
      .filter((shadow) => {
        const lengths = shadow.replace(/[a-z]+\([^)]*\)/gi, "").match(/-?[\d.]+[a-z%]*/gi) ?? [];
        return lengths.length >= 4 && Number.parseFloat(lengths[3]!) !== 0;
      });
  }

  it("casts no veil over Home at any height of the lift", async () => {
    vi.useFakeTimers();
    await renderOverlay();
    const root = screen();
    drawThread(root);
    for (const by of [10, 40, 120, 300]) {
      finger("touchstart", 200, 780);
      finger("touchmove", 200, 780 - by);
      expect(root.style.boxShadow).not.toBe("");
      expect(spreadShadows(root.style.boxShadow)).toEqual([]);
      finger("touchend", 200, 780);
      vi.advanceTimersByTime(250);
    }
  });
});

describe("the gesture home over an open composer", () => {
  it("does not start while the composer stands open", async () => {
    const slot = await renderOverlay();
    const root = screen();
    drawThread(root);
    drawComposer(root, false);
    finger("touchstart", 200, 780);
    finger("touchmove", 200, 660);
    finger("touchend", 200, 660);
    expect(slot.navigateCalls).toEqual([]);
    expect(root.style.transform).toBe("");
  });

  it("starts as ever over a composer bb has drawn compact", async () => {
    const slot = await renderOverlay();
    const root = screen();
    drawThread(root);
    drawComposer(root, true);
    finger("touchstart", 200, 780);
    finger("touchmove", 200, 660);
    finger("touchend", 200, 660);
    expect(slot.navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
  });
});

describe("the section on Home", () => {
  it("marks its root, so the layer under the card can find where it stands", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, THREADS);
    await slot.findByText("Тред Альфы");
    expect(slot.container.querySelector("[data-threads-overview-section]")).not.toBeNull();
  });
});

// bb scopes a plugin's stylesheet to its own roots: every class of this
// plugin's CSS is built behind this selector. A node outside it draws bare —
// icons at their natural size, the skeleton with no fill at all.
const PLUGIN_STYLE_SCOPE = "[data-bb-plugin=threads-overview],[data-bb-plugin-root]:not([data-bb-plugin])";

describe("the layer under the card in the plugin's own styles", () => {
  it("lies in the scope bb gives this plugin's stylesheet, so the list and its skeleton are drawn styled", async () => {
    await renderOverlay();
    expect(layer().matches(PLUGIN_STYLE_SCOPE)).toBe(true);
  });
});

describe("the list under the card within the box it had on Home", () => {
  it("runs no row past that box, down under the composer, as Home's own scroller would not", async () => {
    await renderOverlay();
    expect(sectionBox().style.overflow).toBe("hidden");
  });
});
