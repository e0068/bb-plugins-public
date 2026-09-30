// @vitest-environment jsdom
//
// What lies under the thread screen while a finger carries it home: bb's own
// composer, held in place from the moment the overlay mounts, so the lift only
// moves and shows. The rest of Home is not copied — bb draws it once the finger
// lets go past the reach, and the composer covers the screen until then.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** One finger at a point: jsdom ships no TouchEvent, so the touch list is hung on a plain event. */
function finger(type: string, x: number, y: number, on: Element = document.body): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [{ clientX: x, clientY: y }],
  });
  on.dispatchEvent(event);
}

/** bb's own layout root, the whole screen, holding whatever the route draws. */
function screen(): HTMLElement {
  const root = document.createElement("div");
  root.dataset.testid = "app-layout-root";
  document.body.append(root);
  return root;
}

/** Draw Home in the screen the way bb does on a narrow screen, its composer standing at `composer`. */
function drawHome(
  root: HTMLElement,
  text: string,
  composer: { left: number; width: number; bottom: number } = { left: 12, width: 366, bottom: 776 },
): void {
  root.innerHTML = "";
  const home = document.createElement("div");
  home.dataset.testid = "root-compose-compact-home";
  home.textContent = text;
  const shell = document.createElement("div");
  shell.setAttribute("data-app-composer", "");
  shell.getBoundingClientRect = () =>
    ({ ...composer, right: composer.left + composer.width, top: composer.bottom - 60, height: 60, x: composer.left, y: composer.bottom - 60 }) as DOMRect;
  home.append(shell);
  root.append(home);
}

/** Draw a thread in the screen in place of whatever was there. */
function drawThread(root: HTMLElement): void {
  root.innerHTML = "";
  const thread = document.createElement("div");
  thread.textContent = "беседа треда";
  root.append(thread);
}

function homeLayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-home-swipe-home]");
}

function layerComposer(): HTMLElement | null {
  return homeLayer()?.querySelector<HTMLElement>("[data-testid=bb-new-thread-composer]") ?? null;
}

/** Put a finger down on the bottom strip and carry the screen up by `by` px, without letting go. */
function carry(by: number): void {
  finger("touchstart", 200, 780);
  finger("touchmove", 200, 780 - by);
}

function stubPointer(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: coarse && query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

async function renderOverlay() {
  const app = await loadPluginApp(() => import("./app"));
  const overlay = app.appOverlays.find((registration) => registration.id === "home-swipe")!;
  return renderSlot(overlay, {}, { context: { threadId: "th_a" } });
}

beforeEach(() => {
  stubPointer(true);
  window.innerHeight = 800;
  vi.useFakeTimers();
});
afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("bb's composer held under the screen", () => {
  it("is laid out before any touch, unseen, beneath everything and out of reach", async () => {
    await renderOverlay();
    const layer = homeLayer()!;
    expect(layerComposer()).not.toBeNull();
    expect(layer.style.opacity).toBe("0");
    expect(Number(layer.style.zIndex)).toBeLessThan(0);
    expect(layer.style.pointerEvents).toBe("none");
    expect(layer.hasAttribute("inert")).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
  });

  it("grows with its content rather than filling a box", async () => {
    await renderOverlay();
    expect(layerComposer()!.getAttribute("data-layout")).toBe("document");
  });

  it("is not laid out on a screen without touch, where there is no gesture", async () => {
    stubPointer(false);
    vi.resetModules();
    await renderOverlay();
    expect(homeLayer()).toBeNull();
  });

  it("copies nothing of the screen, Home included", async () => {
    await renderOverlay();
    const root = screen();
    drawHome(root, "домашний экран");
    finger("touchstart", 200, 300);
    finger("touchend", 200, 300);
    drawThread(root);
    carry(120);
    expect(homeLayer()!.textContent).not.toContain("домашний экран");
    expect(document.querySelectorAll("[data-app-composer]")).toHaveLength(0);
  });

  it("stands where the composer stood on Home when last seen", async () => {
    await renderOverlay();
    const root = screen();
    drawHome(root, "домашний экран", { left: 12, width: 366, bottom: 776 });
    await act(async () => {
      finger("touchstart", 200, 300);
      finger("touchend", 200, 300);
    });
    drawThread(root);
    carry(120);
    const box = layerComposer()!.parentElement!;
    expect([box.style.left, box.style.width, box.style.bottom]).toEqual(["12px", "366px", "24px"]);
  });
});

describe("the composer shown as the card lifts", () => {
  it("stays unseen for a plain tap on the strip", async () => {
    await renderOverlay();
    drawThread(screen());
    finger("touchstart", 200, 780);
    expect(homeLayer()!.style.opacity).toBe("0");
  });

  it("comes into view as the card lifts, the card made opaque over it", async () => {
    await renderOverlay();
    const root = screen();
    drawThread(root);
    carry(40);
    expect(homeLayer()!.style.opacity).toBe("");
    expect(root.style.backgroundColor).not.toBe("");
  });

  it("goes unseen again once the card has settled back into the thread", async () => {
    await renderOverlay();
    const root = screen();
    drawThread(root);
    carry(40);
    finger("touchend", 200, 740);
    vi.advanceTimersByTime(250);
    expect(homeLayer()!.style.opacity).toBe("0");
    expect(Number(homeLayer()!.style.zIndex)).toBeLessThan(0);
    expect(root.style.backgroundColor).toBe("");
  });
});

describe("the composer handed over to the live Home", () => {
  async function letGoHome(): Promise<{ root: HTMLElement; navigateCalls: readonly unknown[] }> {
    const slot = await renderOverlay();
    const root = screen();
    drawThread(root);
    carry(120);
    finger("touchend", 200, 660);
    return { root, navigateCalls: slot.navigateCalls };
  }

  it("goes home and covers the screen until the live Home is drawn", async () => {
    const { navigateCalls } = await letGoHome();
    expect(navigateCalls).toContainEqual({ method: "toCompose", options: undefined });
    expect(Number(homeLayer()!.style.zIndex)).toBeGreaterThan(0);
    vi.advanceTimersByTime(500);
    expect(Number(homeLayer()!.style.zIndex)).toBeGreaterThan(0);
  });

  it("fades out once the live Home is on the screen, and waits unseen for the next gesture", async () => {
    const { root } = await letGoHome();
    drawHome(root, "живой домашний экран");
    vi.advanceTimersByTime(50);
    expect(homeLayer()!.style.opacity).toBe("0");
    vi.advanceTimersByTime(200);
    expect(Number(homeLayer()!.style.zIndex)).toBeLessThan(0);
    expect(layerComposer()).not.toBeNull();
  });

  it("steps aside after a second even if the live Home never shows", async () => {
    await letGoHome();
    vi.advanceTimersByTime(1500);
    expect(homeLayer()!.style.opacity).toBe("0");
    expect(Number(homeLayer()!.style.zIndex)).toBeLessThan(0);
  });

  it("is taken off the page with the overlay, mid-handover too", async () => {
    await letGoHome();
    cleanup();
    expect(homeLayer()).toBeNull();
  });
});

describe("the composer under the card shows the project the section chose", () => {
  function thread(id: string, projectId: string): PluginSidebarThread {
    return {
      id,
      projectId,
      title: id,
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

  it("follows the slide pressed in the section", async () => {
    // The section waits for its data on real timers.
    vi.useRealTimers();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    const app = await loadPluginApp(() => import("./app"));
    const section = renderSlot(app.homepageSections[0]!, { projectId: null }, {
      sidebarThreads: {
        status: "ready",
        threads: [thread("th_a", "p_alpha"), thread("th_b", "p_beta")],
        projects: [
          { id: "p_alpha", name: "Альфа", isPersonal: false },
          { id: "p_beta", name: "Бета", isPersonal: false },
        ],
      },
      rpc: { listPostponed: () => ({ postponed: [] }) },
    });
    await renderOverlay();
    fireEvent.click(await section.findByRole("button", { name: /По проекту/ }));
    await act(async () => {
      fireEvent.click(section.getByRole("button", { name: /Бета/ }));
    });
    expect(layerComposer()!.getAttribute("data-default-project-id")).toBe("p_beta");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
